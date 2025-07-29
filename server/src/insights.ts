import { Router } from 'express'
import { z } from 'zod'
import { isProHost, publicUser, publicUserSelect, requireAuth } from './auth.js'
import { db } from './db.js'
import { HttpError } from './errors.js'
import { scoreOf } from './queue.js'

// Host insights (phase 22): numbers about a host's own parties.
// Free for every host: songs played and peak crowd per space. Everything else needs Pro Host,
// checked here on the server. Privacy: no record of who voted how is ever returned; names appear
// only as "top requesters" (who added the songs the room liked).

export const insightsRouter = Router()
insightsRouter.use(requireAuth)

const query = z.object({ spaceId: z.string().optional() })
const TOP = 5

insightsRouter.get('/insights', async (req, res) => {
  const user = req.user!
  if (user.isGuest) throw new HttpError(403, 'Log in with Spotify to see insights')
  const { spaceId } = query.parse(req.query)

  const spaces = await db.space.findMany({
    where: { hostId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, createdAt: true, peakPeople: true, _count: { select: { queueItems: { where: { played: true } } } } },
  })
  if (spaceId && !spaces.some((s) => s.id === spaceId)) throw new HttpError(404, 'Space not found')

  const free = spaces.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, songsPlayed: s._count.queueItems, peakPeople: s.peakPeople }))
  if (!isProHost(user)) return void res.json({ spaces: free, locked: true, details: null })

  const scope = spaceId ? [spaceId] : spaces.map((s) => s.id)
  // ponytail: loads every song of the host's spaces into memory; fine for parties, add SQL aggregation if hosts reach thousands of songs.
  const items = await db.queueItem.findMany({
    where: { spaceId: { in: scope } },
    include: { addedBy: { select: publicUserSelect }, votes: { select: { userId: true, value: true } } },
  })

  const songs = items.map((item) => ({
    id: item.id,
    title: item.title,
    artists: item.artists,
    albumArtUrl: item.albumArtUrl,
    played: item.played,
    skipReason: item.skipReason,
    reactions: item.reactions,
    addedBy: publicUser(item.addedBy),
    ...scoreOf(item),
  }))
  const top = <T>(list: T[], by: (x: T) => number) => [...list].filter((x) => by(x) > 0).sort((a, b) => by(b) - by(a)).slice(0, TOP)

  // Top requesters: who added the songs the room liked. Counts only, no voting history.
  const requesters = new Map<string, { user: ReturnType<typeof publicUser>; songs: number; upvotes: number }>()
  for (const song of songs) {
    const r = requesters.get(song.addedBy.id) ?? { user: song.addedBy, songs: 0, upvotes: 0 }
    r.songs++
    r.upvotes += song.upvotes
    requesters.set(song.addedBy.id, r)
  }

  const participants = new Set<string>()
  for (const item of items) {
    participants.add(item.addedById)
    for (const v of item.votes) participants.add(v.userId)
  }
  participants.delete(user.id)

  // Timelines only make sense for one party.
  const [crowd, voteTimeline] = spaceId
    ? await Promise.all([
        db.presenceSample.findMany({ where: { spaceId }, orderBy: { at: 'asc' }, select: { at: true, people: true }, take: 1440 }),
        db.$queryRaw<{ at: Date; up: number; down: number }[]>`
          SELECT date_bin('10 minutes', v."createdAt", TIMESTAMP '2000-01-01') AS at,
                 count(*) FILTER (WHERE v.value > 0)::int AS up,
                 count(*) FILTER (WHERE v.value < 0)::int AS down
          FROM "Vote" v JOIN "QueueItem" q ON q.id = v."queueItemId"
          WHERE q."spaceId" = ${spaceId}
          GROUP BY 1 ORDER BY 1`,
      ])
    : [null, null]

  res.json({
    spaces: free,
    locked: false,
    details: {
      scope: spaceId ?? 'all',
      totals: {
        parties: scope.length,
        songsAdded: songs.length,
        songsPlayed: songs.filter((s) => s.played).length,
        upvotes: songs.reduce((n, s) => n + s.upvotes, 0),
        downvotes: songs.reduce((n, s) => n + s.downvotes, 0),
        reactions: songs.reduce((n, s) => n + s.reactions, 0),
        skippedByHost: songs.filter((s) => s.skipReason === 'host').length,
        skippedByRoom: songs.filter((s) => s.skipReason === 'room').length,
        participants: participants.size,
      },
      topSongs: top(songs, (s) => s.score),
      mostDownvoted: top(songs, (s) => s.downvotes),
      mostReactions: top(songs, (s) => s.reactions),
      skipped: songs.filter((s) => s.skipReason).slice(0, TOP * 2),
      topRequesters: [...requesters.values()].sort((a, b) => b.upvotes - a.upvotes || b.songs - a.songs).slice(0, TOP),
      crowd,
      voteTimeline, // counts per 10 minutes, never who voted
    },
  })
})
