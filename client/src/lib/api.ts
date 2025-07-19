// Types mirror the server's JSON responses (server/src/*.ts).

export type PublicUser = { id: string; displayName: string; avatarUrl: string | null; isGuest: boolean; isPro: boolean }

export type Me = PublicUser & {
  paidUntil: string | null
  hasSubscription: boolean
  pendingPayment: boolean
  billingEnabled: boolean
  hostPlanEnabled: boolean
  isProHost: boolean
  isAdmin: boolean
}

export type Plan = 'pro' | 'pro_host'
export type PlanPrices = Record<Plan, number | null>

export type SpaceSettings = { maxQueue: number; voteLimit: number; queueLocked: boolean }

export type Space = SpaceSettings & { id: string; name: string; hostId: string; createdAt: string; currentItemId: string | null }

export type SpaceDetail = Space & { host: PublicUser }

export type Track = {
  trackId: string
  trackUri: string
  title: string
  artists: string[]
  albumArtUrl: string | null
  durationMs: number
}

export type QueueItem = Track & {
  id: string
  addedBy: PublicUser
  createdAt: string
  upvotes: number
  downvotes: number
  /** upvotes − downvotes × weight (downvotes count less on Pro users' songs) */
  score: number
  /** true when the adder is Pro, so downvotes count less */
  protected: boolean
  myVote: 1 | -1 | null
}

export type HistoryItem = Track & { id: string; addedBy: PublicUser; playedAt: string }

export type NowPlaying = QueueItem & { startedAt: string | null }

export type Quota = { limit: number; votesUsed: number; votesLeft: number; lockedUntil: string | null }

export type QueueState = {
  queue: QueueItem[]
  nowPlaying: NowPlaying | null
  quota: Quota
  settings: SpaceSettings
  skip: { votes: number; needed: number; voted: boolean } | null
}

export type Presence = { count: number; users: PublicUser[] }

export type Reaction = { emoji: string; from: string }

// Mirrors server/src/realtime.ts
export const REACTIONS = ['🔥', '👏', '💃', '😍', '🤯', '👎'] as const

// Mirrors server/src/config.ts (settings form limits, and optimistic score updates)
export const PRO_DOWNVOTE_WEIGHT = 0.4
export const MAX_QUEUE_RANGE = { min: 5, max: 50 }
export const VOTE_LIMIT_RANGE = { min: 1, max: 20 }

/** Same formula as the server: more than half of the people present, and at least 2. */
export const skipThreshold = (present: number) => Math.max(2, Math.floor(present / 2) + 1)

export type PlayerState = { spaceId: string; itemId: string | null; paused: boolean; positionMs: number }

export class ApiError extends Error {
  status: number
  body: Record<string, unknown>
  constructor(status: number, message: string, body: Record<string, unknown>) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, typeof data.error === 'string' ? data.error : 'Something went wrong', data)
  return data as T
}

export const isStatus = (err: unknown, status: number) => err instanceof ApiError && err.status === status

export function spotifyLoginUrl(returnTo?: string) {
  return `/api/auth/spotify/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`
}

// ---- Host insights (phase 22) ----

export type InsightSong = {
  id: string
  title: string
  artists: string[]
  albumArtUrl: string | null
  played: boolean
  skipReason: 'host' | 'room' | null
  reactions: number
  addedBy: PublicUser
  upvotes: number
  downvotes: number
  score: number
}

export type InsightSpace = { id: string; name: string; createdAt: string; songsPlayed: number; peakPeople: number }

export type Insights = {
  spaces: InsightSpace[]
  locked: boolean
  details: null | {
    scope: string
    totals: {
      parties: number
      songsAdded: number
      songsPlayed: number
      upvotes: number
      downvotes: number
      reactions: number
      skippedByHost: number
      skippedByRoom: number
      participants: number
    }
    topSongs: InsightSong[]
    mostDownvoted: InsightSong[]
    mostReactions: InsightSong[]
    skipped: InsightSong[]
    topRequesters: { user: PublicUser; songs: number; upvotes: number }[]
    crowd: { at: string; people: number }[] | null
    voteTimeline: { at: string; up: number; down: number }[] | null
  }
}
