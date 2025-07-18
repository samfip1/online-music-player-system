import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { io as connect, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { signSession } from '../src/auth.js'
import { attachRealtime } from '../src/realtime.js'
import { addSongs, as, makeSpace, makeUser, resetDb } from './helpers.js'

let server: Server
let url: string
const sockets: Socket[] = []

beforeAll(async () => {
  server = createServer(app)
  attachRealtime(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  sockets.forEach((s) => s.close())
  await new Promise((resolve) => server.close(resolve))
})
beforeEach(resetDb)

/** Connects as a user and joins a space; resolves once the server has put the socket in the room. */
async function joined(userId: string | null, spaceId: string) {
  const socket = connect(url, { extraHeaders: userId ? { Cookie: `sid=${signSession(userId)}` } : {}, reconnection: false })
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', resolve)
    socket.on('connect_error', reject)
  })
  socket.emit('join', spaceId)
  await new Promise((r) => setTimeout(r, 100))
  return socket
}

const next = <T>(socket: Socket, event: string, ms = 1000) =>
  new Promise<T | 'timeout'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms)
    socket.once(event, (data: T) => {
      clearTimeout(timer)
      resolve(data)
    })
  })

describe('realtime', () => {
  it('rejects sockets without a login', async () => {
    const { space } = await makeSpace()
    await expect(joined(null, space.id)).rejects.toThrow('Not logged in')
  })

  it('tells everyone in the space when the queue changes, and nobody else', async () => {
    const { space, host } = await makeSpace()
    const [song] = await addSongs(space.id, host.id, 1)
    const other = await makeSpace()
    const listener = await makeUser({ isGuest: true })

    const inSpace = await joined(listener.id, space.id)
    const elsewhere = await joined(listener.id, other.space.id)
    const gotIt = next(inSpace, 'queue:changed')
    const leaked = next(elsewhere, 'queue:changed', 300)

    await as(listener.id).post(`/api/spaces/${space.id}/queue/${song.id}/vote`)
    expect(await gotIt).not.toBe('timeout')
    expect(await leaked).toBe('timeout')
  })

  it('relays player state from the host only, and replays it to late joiners', async () => {
    const { space, host } = await makeSpace()
    const listener = await makeUser({ isGuest: true })
    const hostSocket = await joined(host.id, space.id)
    const listenerSocket = await joined(listener.id, space.id)

    const fake = next(hostSocket, 'player:state', 300)
    listenerSocket.emit('player:state', { spaceId: space.id, itemId: 'x', paused: false, positionMs: 1 })
    expect(await fake).toBe('timeout')

    const real = next(listenerSocket, 'player:state')
    hostSocket.emit('player:state', { spaceId: space.id, itemId: 'x', paused: true, positionMs: 42_000 })
    expect(await real).toMatchObject({ itemId: 'x', paused: true, positionMs: 42_000 })

    const late = await makeUser({ isGuest: true })
    const lateSocket = connect(url, { extraHeaders: { Cookie: `sid=${signSession(late.id)}` }, reconnection: false })
    sockets.push(lateSocket)
    const replay = next(lateSocket, 'player:state')
    lateSocket.on('connect', () => lateSocket.emit('join', space.id))
    expect(await replay).toMatchObject({ itemId: 'x', positionMs: 42_000 })
  })
})

describe('presence, reactions and bans', () => {
  it('tracks who is here, counting each person once across tabs', async () => {
    const { space, host } = await makeSpace()
    const guest = await makeUser({ isGuest: true })
    const hostSocket = await joined(host.id, space.id)
    const update = next<{ count: number; users: { id: string }[] }>(hostSocket, 'presence')
    const tab1 = await joined(guest.id, space.id)
    expect(await update).toMatchObject({ count: 2 })

    await joined(guest.id, space.id) // second tab, same person
    const { body } = await as(host.id).get(`/api/spaces/${space.id}/queue`)
    expect(body.skip).toBeNull() // nothing playing yet
    const leave = next<{ count: number }>(hostSocket, 'presence')
    tab1.close()
    expect(await leave).toMatchObject({ count: 2 }) // the other tab keeps the guest present
  })

  it('relays reactions from the list only, and rate-limits each socket', async () => {
    const { space, host } = await makeSpace()
    const guest = await makeUser({ isGuest: true })
    const hostSocket = await joined(host.id, space.id)
    const guestSocket = await joined(guest.id, space.id)

    const received: string[] = []
    hostSocket.on('reaction', (r: { emoji: string }) => received.push(r.emoji))
    guestSocket.emit('reaction', { spaceId: space.id, emoji: '💩' }) // not on the list
    for (let i = 0; i < 8; i++) guestSocket.emit('reaction', { spaceId: space.id, emoji: '🔥' })
    const other = await makeSpace()
    guestSocket.emit('reaction', { spaceId: other.space.id, emoji: '🔥' }) // not in that room
    await new Promise((r) => setTimeout(r, 300))
    expect(received).toEqual(['🔥', '🔥', '🔥', '🔥', '🔥'])
  })

  it('kicks a banned person\'s open sockets and refuses to let them rejoin', async () => {
    const { space, host } = await makeSpace()
    const troll = await makeUser({ isGuest: true })
    const trollSocket = await joined(troll.id, space.id)
    const removed = next(trollSocket, 'removed')
    await as(host.id).post(`/api/spaces/${space.id}/bans`).send({ userId: troll.id })
    expect(await removed).toEqual({ spaceId: space.id })

    const again = next(trollSocket, 'removed')
    trollSocket.emit('join', space.id)
    expect(await again).toEqual({ spaceId: space.id })
  })
})

describe('host insights data', () => {
  it('records the peak crowd, and samples presence', async () => {
    const { samplePresence } = await import('../src/realtime.js')
    const { space, host } = await makeSpace()
    const guest = await makeUser({ isGuest: true })
    await joined(host.id, space.id)
    await joined(guest.id, space.id)
    await new Promise((r) => setTimeout(r, 100))
    const { db } = await import('./helpers.js')
    expect((await db.space.findUniqueOrThrow({ where: { id: space.id } })).peakPeople).toBe(2)
    await samplePresence()
    expect(await db.presenceSample.findMany({ where: { spaceId: space.id }, select: { people: true } })).toEqual([{ people: 2 }])
  })
})
