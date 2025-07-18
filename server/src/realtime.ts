import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { z } from 'zod'
import { isAdmin, publicUser, sessionFromCookieHeader } from './auth.js'
import { env } from './config.js'
import { db } from './db.js'
import type { User } from './generated/prisma/client.js'

// Events sent to the room `space:<id>`:
// - "queue:changed": no payload. Clients refetch GET /queue, because that response has
//   per-user fields (my votes, my quota) that one broadcast payload couldn't carry.
// - "player:state": the host's playback position, so listeners see a live progress bar.
// - "presence": who's in the space right now.
// - "reaction": a floating emoji. Only a per-song count is stored (host insights).
// - "skipped": the room voted the current song out.
// To one socket: "removed" when the host bans that person.
// To the "admin" room: "admin:changed", a throttled nudge to refetch live stats.

type PublicUser = ReturnType<typeof publicUser>

let io: Server | null = null
const room = (spaceId: string) => `space:${spaceId}`

// ---- Presence ----
// ponytail: all in memory for one server instance. Several instances would need the Socket.IO Redis adapter.

const presence = new Map<string, Map<string, { sockets: number; user: PublicUser }>>()

export function presenceOf(spaceId: string) {
  const users = [...(presence.get(spaceId)?.values() ?? [])].map((p) => p.user)
  return { count: users.length, users }
}

/** Spaces with anyone in them, for the admin dashboard. */
export function livePresence() {
  return [...presence.entries()].map(([spaceId, people]) => ({ spaceId, users: [...people.values()].map((p) => p.user) }))
}

function addPresence(spaceId: string, user: PublicUser) {
  const people = presence.get(spaceId) ?? new Map()
  presence.set(spaceId, people)
  const entry = people.get(user.id)
  people.set(user.id, { sockets: (entry?.sockets ?? 0) + 1, user })
  broadcastPresence(spaceId)
  // Biggest crowd seen, for host insights. Only ever raised, in one statement, so concurrent joins can't lower it.
  void db.$executeRaw`UPDATE "Space" SET "peakPeople" = ${people.size} WHERE id = ${spaceId} AND "peakPeople" < ${people.size}`.catch(
    (err) => console.error(err),
  )
}

/** Once a minute: head count of every space with people in it ("crowd over time" in host insights). */
export async function samplePresence() {
  const data = [...presence.entries()].map(([spaceId, people]) => ({ spaceId, people: people.size }))
  // One by one: a space deleted in the meantime fails only its own row.
  for (const row of data) await db.presenceSample.create({ data: row }).catch(() => {})
}

function removePresence(spaceId: string, userId: string) {
  const people = presence.get(spaceId)
  const entry = people?.get(userId)
  if (!people || !entry) return
  if (entry.sockets > 1) people.set(userId, { ...entry, sockets: entry.sockets - 1 })
  else people.delete(userId)
  if (people.size === 0) presence.delete(spaceId)
  broadcastPresence(spaceId)
}

function broadcastPresence(spaceId: string) {
  io?.to(room(spaceId)).emit('presence', presenceOf(spaceId))
  notifyAdmin()
}

// ---- Player state ----

const playerState = z.object({
  spaceId: z.string(),
  itemId: z.string().nullable(),
  paused: z.boolean(),
  positionMs: z.number().int().min(0),
})
type PlayerState = z.infer<typeof playerState>

// Last known state per space (with the server time it arrived), so late joiners get it immediately.
const lastState = new Map<string, PlayerState & { at: number }>()

function withElapsed(s: PlayerState & { at: number }): PlayerState {
  const { at, ...state } = s
  return state.paused ? state : { ...state, positionMs: state.positionMs + (Date.now() - at) }
}

// ---- Reactions ----

export const REACTIONS = ['🔥', '👏', '💃', '😍', '🤯', '👎'] as const
const REACTION_WINDOW_MS = 3000
const REACTIONS_PER_WINDOW = 5

// ---- Notifications used by the HTTP routes ----

/** Tell everyone in the space to refetch. Safe to call in tests (no server attached = no-op). */
export function notifySpace(spaceId: string) {
  io?.to(room(spaceId)).emit('queue:changed')
  notifyAdmin()
}

export function announceSkip(spaceId: string, title: string) {
  io?.to(room(spaceId)).emit('skipped', { title })
}

/** Kicks a banned user's open sockets out of the space. */
export async function removeFromSpace(spaceId: string, userId: string) {
  if (!io) return
  for (const socket of await io.in(room(spaceId)).fetchSockets()) {
    if (socket.data.user.id !== userId) continue
    socket.emit('removed', { spaceId })
    socket.leave(room(spaceId))
    removePresence(spaceId, userId)
  }
}

// At most one admin nudge every 2 seconds, however busy the app is.
let adminTimer: NodeJS.Timeout | null = null
function notifyAdmin() {
  if (!io || adminTimer) return
  adminTimer = setTimeout(() => {
    adminTimer = null
    io?.to('admin').emit('admin:changed')
  }, 2000)
}

// ---- Server ----

export function attachRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.CLIENT_URL, credentials: true } })
  setInterval(() => void samplePresence(), 60_000).unref()

  io.use(async (socket, next) => {
    const userId = sessionFromCookieHeader(socket.handshake.headers.cookie)
    const user = userId ? await db.user.findUnique({ where: { id: userId } }) : null
    if (!user) return next(new Error('Not logged in'))
    socket.data.user = publicUser(user)
    socket.data.admin = isAdmin(user)
    socket.data.hosting = new Set<string>()
    socket.data.reactions = [] as number[]
    next()
  })

  io.on('connection', (socket) => {
    const me = socket.data.user as PublicUser
    const joinedSpaces = () => [...socket.rooms].filter((r) => r.startsWith('space:')).map((r) => r.slice('space:'.length))

    socket.on('join', async (spaceId: unknown) => {
      if (typeof spaceId !== 'string') return
      const [space, ban] = await Promise.all([
        db.space.findUnique({ where: { id: spaceId }, select: { hostId: true } }),
        db.spaceBan.findUnique({ where: { spaceId_userId: { spaceId, userId: me.id } } }),
      ])
      if (!space) return
      if (ban) return void socket.emit('removed', { spaceId })

      for (const other of joinedSpaces()) {
        if (other === spaceId) return // already here (e.g. a reconnect that kept the room)
        await socket.leave(room(other))
        removePresence(other, me.id)
      }
      await socket.join(room(spaceId))
      if (space.hostId === me.id) socket.data.hosting.add(spaceId)
      addPresence(spaceId, me)
      const state = lastState.get(spaceId)
      if (state) socket.emit('player:state', withElapsed(state))
    })

    // Only the verified host of a space may broadcast its playback state.
    socket.on('player:state', (data: unknown) => {
      const parsed = playerState.safeParse(data)
      if (!parsed.success || !socket.data.hosting.has(parsed.data.spaceId)) return
      lastState.set(parsed.data.spaceId, { ...parsed.data, at: Date.now() })
      socket.to(room(parsed.data.spaceId)).emit('player:state', parsed.data)
    })

    socket.on('reaction', (data: unknown) => onReaction(socket, me, data))

    socket.on('admin:join', () => {
      if (socket.data.admin) void socket.join('admin')
    })

    socket.on('disconnecting', () => {
      for (const spaceId of joinedSpaces()) removePresence(spaceId, me.id)
    })
  })
}

const reactionMessage = z.object({ spaceId: z.string(), emoji: z.enum(REACTIONS) })

function onReaction(socket: Socket, me: PublicUser, data: unknown) {
  const parsed = reactionMessage.safeParse(data)
  if (!parsed.success || !socket.rooms.has(room(parsed.data.spaceId))) return
  // Per-socket rate limit: extras are dropped silently so a spammer can't flood everyone's screen.
  const now = Date.now()
  const recent = (socket.data.reactions as number[]).filter((t) => now - t < REACTION_WINDOW_MS)
  if (recent.length >= REACTIONS_PER_WINDOW) return
  socket.data.reactions = [...recent, now]
  io?.to(room(parsed.data.spaceId)).emit('reaction', { emoji: parsed.data.emoji, from: me.displayName })
  // Counted on the song playing now, for "most reactions" in host insights.
  void db.$executeRaw`
    UPDATE "QueueItem" SET "reactions" = "reactions" + 1
    WHERE id = (SELECT "currentItemId" FROM "Space" WHERE id = ${parsed.data.spaceId})`.catch((err) => console.error(err))
}
