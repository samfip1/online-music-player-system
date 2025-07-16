import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decrypt, encrypt } from '../src/crypto.js'
import { addSongs, as, db, makeSpace, makeUser, resetDb } from './helpers.js'

// Spotify is faked: any valid-looking id returns a track, the id "missing…" doesn't exist.
vi.mock('../src/spotify.js', async (original) => ({
  ...(await original<typeof import('../src/spotify.js')>()),
  getTrack: async (trackId: string) =>
    trackId.startsWith('missing')
      ? null
      : { trackId, trackUri: `spotify:track:${trackId}`, title: 'From Spotify', artists: ['Real Artist'], albumArtUrl: null, durationMs: 1000 },
}))

const id = (n: number) => `track${n}`.padEnd(22, 'x')

beforeEach(resetDb)

describe('adding songs', () => {
  it('uses Spotify metadata, not what the client sends', async () => {
    const { space } = await makeSpace()
    const guest = await makeUser({ isGuest: true })
    const res = await as(guest.id).post(`/api/spaces/${space.id}/queue`).send({ trackId: id(1), title: 'Fake title' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ title: 'From Spotify', artists: ['Real Artist'], score: 0, upvotes: 0, downvotes: 0, myVote: null })
  })

  it('rejects duplicates, unknown tracks, bad ids and a full queue', async () => {
    const { space, host } = await makeSpace()
    const add = (trackId: string) => as(host.id).post(`/api/spaces/${space.id}/queue`).send({ trackId })

    expect((await add(id(1))).status).toBe(201)
    expect((await add(id(1))).status).toBe(409)
    expect((await add('missing'.padEnd(22, 'x'))).status).toBe(404)
    expect((await add('../../me')).status).toBe(400)

    for (let n = 2; n <= 20; n++) expect((await add(id(n))).status).toBe(201)
    expect((await add(id(21))).status).toBe(422)
  })
})

describe('host-only actions', () => {
  it('blocks guests and non-hosts', async () => {
    const { space } = await makeSpace()
    const guest = await makeUser({ isGuest: true })
    const other = await makeUser()

    expect((await as(guest.id).post('/api/spaces').send({ name: 'Mine' })).status).toBe(403)
    expect((await as(other.id).post(`/api/spaces/${space.id}/next`)).status).toBe(403)
    expect((await as(other.id).delete(`/api/spaces/${space.id}/queue`)).status).toBe(403)
    expect((await as(other.id).delete(`/api/spaces/${space.id}`)).status).toBe(403)
  })

  it('requires a login', async () => {
    const { space } = await makeSpace()
    const res = await as('no-such-user').get(`/api/spaces/${space.id}/queue`)
    expect(res.status).toBe(401)
  })
})

describe('play next', () => {
  it('plays the most-voted song, breaking ties by the earliest added', async () => {
    const { space, host } = await makeSpace()
    const [a, b, c] = await addSongs(space.id, host.id, 3)
    const voter1 = await makeUser()
    const voter2 = await makeUser()
    await as(voter1.id).post(`/api/spaces/${space.id}/queue/${c.id}/vote`)
    await as(voter2.id).post(`/api/spaces/${space.id}/queue/${c.id}/vote`)
    await as(voter1.id).post(`/api/spaces/${space.id}/queue/${b.id}/vote`)
    await as(voter2.id).post(`/api/spaces/${space.id}/queue/${a.id}/vote`)

    const next = () => as(host.id).post(`/api/spaces/${space.id}/next`)
    expect((await next()).body.nowPlaying.id).toBe(c.id) // 2 votes
    expect((await next()).body.nowPlaying.id).toBe(a.id) // 1 vote, added before b
    expect((await next()).body.nowPlaying.id).toBe(b.id)
    expect((await next()).body.nowPlaying).toBeNull() // queue empty

    const played = await db.queueItem.findUniqueOrThrow({ where: { id: c.id } })
    expect(played.played).toBe(true)
    expect(played.playedAt).not.toBeNull()
  })

  it('does not skip twice when two "next" calls race for the same song', async () => {
    const { space, host } = await makeSpace()
    const [a, b] = await addSongs(space.id, host.id, 2)
    const next = (currentItemId: string | null) => as(host.id).post(`/api/spaces/${space.id}/next`).send({ currentItemId })

    expect((await next(null)).body.nowPlaying.id).toBe(a.id)
    const [first, second] = await Promise.all([next(a.id), next(a.id)])
    expect(first.body.nowPlaying.id).toBe(b.id)
    expect(second.body.nowPlaying.id).toBe(b.id)
  })

  it('shows now playing and my votes in the queue response', async () => {
    const { space, host } = await makeSpace()
    const [a, b] = await addSongs(space.id, host.id, 2)
    await as(host.id).post(`/api/spaces/${space.id}/queue/${b.id}/vote`)
    await as(host.id).post(`/api/spaces/${space.id}/next`)

    const { body } = await as(host.id).get(`/api/spaces/${space.id}/queue`)
    expect(body.nowPlaying.id).toBe(b.id)
    expect(body.queue.map((i: { id: string }) => i.id)).toEqual([a.id])
    expect(body.queue[0].myVote).toBeNull()
    expect(body.nowPlaying.myVote).toBe(1)
    expect(body.queue[0].addedBy).not.toHaveProperty('email')
  })
})

it('encrypts refresh tokens reversibly and differently each time', () => {
  const a = encrypt('refresh-token')
  expect(a).not.toContain('refresh-token')
  expect(a).not.toBe(encrypt('refresh-token'))
  expect(decrypt(a)).toBe('refresh-token')
})
