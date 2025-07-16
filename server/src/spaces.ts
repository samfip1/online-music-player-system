import { Router, type Request } from 'express'
import { z } from 'zod'
import { publicUser, publicUserSelect, requireAuth } from './auth.js'
import { MAX_QUEUE_RANGE, VOTE_LIMIT_RANGE } from './config.js'
import { db } from './db.js'
import { HttpError } from './errors.js'
import { advanceQueue, lockSpace, queueItemInclude, rankQueue, skipThreshold, toQueueItem } from './queue.js'
import { announceSkip, notifySpace, presenceOf, removeFromSpace } from './realtime.js'
import { getTrack } from './spotify.js'
import { castVote, getQuota, removeVote } from './votes.js'

async function findSpace(id: string) {
  const space = await db.space.findUnique({ where: { id } })
  if (!space) throw new HttpError(404, 'Space not found')
  return space
}

/** Host check uses the session user only. Guests can never host, since they can't create spaces. */
async function findHostedSpace(req: Request<{ id: string }>) {
  const space = await findSpace(req.params.id)
  if (space.hostId !== req.user!.id) throw new HttpError(403, 'Only the host can do this')
  return space
}

export const spacesRouter = Router()
spacesRouter.use(requireAuth)

// Every route with a space id refuses people the host removed.
spacesRouter.param('id', async (req, _res, next, spaceId: string) => {
  try {
    const ban = await db.spaceBan.findUnique({ where: { spaceId_userId: { spaceId, userId: req.user!.id } } })
    if (ban) throw new HttpError(403, 'The host removed you from this space', { code: 'banned' })
    next()
  } catch (err) {
    next(err)
  }
})

// ---- Spaces ----

const createSpaceBody = z.object({ name: z.string().trim().min(1).max(60) })

spacesRouter.post('/', async (req, res) => {
  if (req.user!.isGuest) throw new HttpError(403, 'Log in with Spotify to host a space')
  const { name } = createSpaceBody.parse(req.body)
  res.status(201).json(await db.space.create({ data: { name, hostId: req.user!.id } }))
})

spacesRouter.get('/', async (req, res) => {
  res.json(await db.space.findMany({ where: { hostId: req.user!.id }, orderBy: { createdAt: 'desc' } }))
})

spacesRouter.get('/:id', async (req, res) => {
  const space = await db.space.findUnique({ where: { id: req.params.id }, include: { host: { select: publicUserSelect } } })
  if (!space) throw new HttpError(404, 'Space not found')
  res.json({ ...space, host: publicUser(space.host) })
})

// Host settings (phase 18). A new vote limit applies from each person's next vote.
const settingsBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    maxQueue: z.number().int().min(MAX_QUEUE_RANGE.min).max(MAX_QUEUE_RANGE.max),
    voteLimit: z.number().int().min(VOTE_LIMIT_RANGE.min).max(VOTE_LIMIT_RANGE.max),
    queueLocked: z.boolean(),
  })
  .partial()
  .strict()

spacesRouter.patch('/:id', async (req, res) => {
  const space = await findHostedSpace(req)
  const data = settingsBody.parse(req.body)
  const updated = await db.space.update({ where: { id: space.id }, data })
  notifySpace(space.id)
  res.json(updated)
})

spacesRouter.delete('/:id', async (req, res) => {
  const space = await findHostedSpace(req)
  await db.space.delete({ where: { id: space.id } })
  notifySpace(space.id) // listeners refetch, get 404 and see "this space has ended"
  res.status(204).end()
})

// ---- Queue ----

spacesRouter.get('/:id/queue', async (req, res) => {
  const me = req.user!.id
  const space = await db.space.findUnique({
    where: { id: req.params.id },
    include: { currentItem: { include: { ...queueItemInclude, skipVotes: { select: { userId: true } } } } },
  })
  if (!space) throw new HttpError(404, 'Space not found')

  const [items, quota] = await Promise.all([
    db.queueItem.findMany({ where: { spaceId: space.id, played: false }, include: queueItemInclude }),
    getQuota(me, space.id, space.voteLimit),
  ])
  const current = space.currentItem

  res.json({
    queue: rankQueue(items).map((item) => toQueueItem(item, me)),
    nowPlaying: current ? { ...toQueueItem(current, me), startedAt: space.currentStartedAt } : null,
    quota,
    settings: { maxQueue: space.maxQueue, voteLimit: space.voteLimit, queueLocked: space.queueLocked },
    skip: current
      ? {
          votes: current.skipVotes.length,
          needed: skipThreshold(presenceOf(space.id).count),
          voted: current.skipVotes.some((v) => v.userId === me),
        }
      : null,
  })
})

// Spotify ids are 22 base-62 characters; checking the shape also keeps the value safe to put in a URL.
const addBody = z.object({ trackId: z.string().regex(/^[0-9A-Za-z]{22}$/, 'Invalid Spotify track id') })

spacesRouter.post('/:id/queue', async (req, res) => {
  const { trackId } = addBody.parse(req.body)
  const space = await findSpace(req.params.id)
  const isHost = space.hostId === req.user!.id
  if (space.queueLocked && !isHost) throw new HttpError(403, 'The host has locked the queue')

  // Title, artists, art and duration come from Spotify, never from the client.
  // Fetched before the transaction so the space isn't locked during a network call.
  const track = await getTrack(trackId)
  if (!track) throw new HttpError(404, 'Track not found on Spotify')

  const item = await db.$transaction(async (tx) => {
    await lockSpace(tx, space.id)
    const { maxQueue } = await tx.space.findUniqueOrThrow({ where: { id: space.id }, select: { maxQueue: true } })
    const unplayed = await tx.queueItem.count({ where: { spaceId: space.id, played: false } })
    if (unplayed >= maxQueue) throw new HttpError(422, `The queue is full (max ${maxQueue} songs)`)
    const duplicate = await tx.queueItem.findFirst({ where: { spaceId: space.id, played: false, trackId } })
    if (duplicate) throw new HttpError(409, 'This song is already in the queue')
    return tx.queueItem.create({ data: { ...track, spaceId: space.id, addedById: req.user!.id }, include: queueItemInclude })
  })
  notifySpace(space.id)
  res.status(201).json(toQueueItem(item, req.user!.id))
})

spacesRouter.delete('/:id/queue/:itemId', async (req, res) => {
  const space = await findHostedSpace(req)
  const { count } = await db.queueItem.deleteMany({ where: { id: req.params.itemId, spaceId: space.id } })
  if (count === 0) throw new HttpError(404, 'Song is not in the queue')
  notifySpace(space.id)
  res.status(204).end()
})

// Clears the upcoming songs only; the song playing now and the play history stay.
spacesRouter.delete('/:id/queue', async (req, res) => {
  const space = await findHostedSpace(req)
  await db.queueItem.deleteMany({ where: { spaceId: space.id, played: false } })
  notifySpace(space.id)
  res.status(204).end()
})

// Recently played (phase 12): newest first, not counting the song playing now.
spacesRouter.get('/:id/history', async (req, res) => {
  const space = await findSpace(req.params.id)
  const items = await db.queueItem.findMany({
    where: { spaceId: space.id, played: true, NOT: space.currentItemId ? { id: space.currentItemId } : undefined },
    orderBy: { playedAt: 'desc' },
    take: 20,
    include: { addedBy: { select: publicUserSelect } },
  })
  res.json(items.map(({ addedBy, ...item }) => ({ ...item, addedBy: publicUser(addedBy) })))
})

// ---- Votes ----

const voteBody = z.object({ value: z.union([z.literal(1), z.literal(-1)]).default(1) })

spacesRouter.post('/:id/queue/:itemId/vote', async (req, res) => {
  const { value } = voteBody.parse(req.body ?? {})
  const space = await findSpace(req.params.id)
  const quota = await castVote(req.user!, space.id, req.params.itemId, value)
  notifySpace(space.id)
  res.status(201).json({ quota })
})

spacesRouter.delete('/:id/queue/:itemId/vote', async (req, res) => {
  const space = await findSpace(req.params.id)
  await removeVote(req.user!.id, space.id, req.params.itemId)
  notifySpace(space.id)
  res.json({ quota: await getQuota(req.user!.id, space.id, space.voteLimit) })
})

// ---- Play next / skip ----

// currentItemId: the song the host's player thinks is playing (see advanceQueue).
// reason: "skipped" when the host pressed Skip, "ended" when the song finished (host insights count skips).
const nextBody = z.object({ currentItemId: z.string().nullable().optional(), reason: z.enum(['ended', 'skipped']).optional() })

spacesRouter.post('/:id/next', async (req, res) => {
  const { currentItemId, reason } = nextBody.parse(req.body ?? {})
  const space = await findHostedSpace(req)
  const { nowPlaying, startedAt } = await advanceQueue(space.id, currentItemId, reason === 'skipped' ? 'host' : undefined)
  notifySpace(space.id)
  res.json({ nowPlaying: nowPlaying ? { ...toQueueItem(nowPlaying, req.user!.id), startedAt } : null })
})

// Vote to skip the song playing now (phase 17). No quota, and no Pro protection: if more than
// half the room wants it gone, it goes.
spacesRouter.post('/:id/skip-vote', async (req, res) => {
  const space = await findSpace(req.params.id)
  if (!space.currentItemId) throw new HttpError(409, 'Nothing is playing')
  const itemId = space.currentItemId

  const created = await db.skipVote.createMany({ data: [{ queueItemId: itemId, userId: req.user!.id }], skipDuplicates: true })
  if (created.count === 0) throw new HttpError(409, 'You already voted to skip this song')

  const votes = await db.skipVote.count({ where: { queueItemId: itemId } })
  const needed = skipThreshold(presenceOf(space.id).count)
  let skipped = false
  if (votes >= needed) {
    // advanceQueue with the expected id: if the song already changed, this is a no-op.
    const result = await advanceQueue(space.id, itemId, 'room')
    if (result.advanced) {
      skipped = true
      const title = (await db.queueItem.findUnique({ where: { id: itemId }, select: { title: true } }))?.title
      announceSkip(space.id, title ?? 'this song')
    }
  }
  notifySpace(space.id)
  res.status(201).json({ votes, needed, skipped })
})

// ---- Bans (phase 15) ----

spacesRouter.get('/:id/bans', async (req, res) => {
  const space = await findHostedSpace(req)
  const bans = await db.spaceBan.findMany({
    where: { spaceId: space.id },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: publicUserSelect } },
  })
  res.json(bans.map((b) => ({ ...publicUser(b.user), bannedAt: b.createdAt })))
})

const banBody = z.object({ userId: z.string().min(1) })

spacesRouter.post('/:id/bans', async (req, res) => {
  const space = await findHostedSpace(req)
  const { userId } = banBody.parse(req.body)
  if (userId === space.hostId) throw new HttpError(400, "You can't remove yourself")
  if (!(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new HttpError(404, 'User not found')

  // Their votes on waiting songs stop counting. Songs they added stay; the host can remove those.
  await db.$transaction([
    db.spaceBan.upsert({ where: { spaceId_userId: { spaceId: space.id, userId } }, create: { spaceId: space.id, userId }, update: {} }),
    db.vote.deleteMany({ where: { userId, queueItem: { spaceId: space.id, played: false } } }),
    db.skipVote.deleteMany({ where: { userId, queueItem: { spaceId: space.id } } }),
  ])
  await removeFromSpace(space.id, userId)
  notifySpace(space.id)
  res.status(201).json({ ok: true })
})

spacesRouter.delete('/:id/bans/:userId', async (req, res) => {
  const space = await findHostedSpace(req)
  await db.spaceBan.deleteMany({ where: { spaceId: space.id, userId: req.params.userId } })
  res.status(204).end()
})
