import { isPro, publicUser, publicUserSelect } from './auth.js'
import { PRO_DOWNVOTE_WEIGHT } from './config.js'
import { db } from './db.js'
import type { Prisma } from './generated/prisma/client.js'

// Ranking lives here so GET /queue and "play next" can never disagree about the order.

export const queueItemInclude = {
  addedBy: { select: publicUserSelect },
  votes: { select: { userId: true, value: true } },
} satisfies Prisma.QueueItemInclude

export type QueueItemRow = Prisma.QueueItemGetPayload<{ include: typeof queueItemInclude }>

/**
 * score = upvotes − downvotes × weight. The weight is PRO_DOWNVOTE_WEIGHT when the song's *adder*
 * is Pro right now (checked at ranking time, so an expired subscription loses the protection).
 */
export function scoreOf(item: QueueItemRow) {
  let upvotes = 0
  let downvotes = 0
  for (const v of item.votes) {
    if (v.value > 0) upvotes++
    else downvotes++
  }
  const weight = isPro(item.addedBy) ? PRO_DOWNVOTE_WEIGHT : 1
  // Rounded so 2 − 4 × 0.4 is exactly 0.4, not 0.39999…
  const score = Math.round((upvotes - downvotes * weight) * 100) / 100
  return { upvotes, downvotes, score, protected: weight < 1 }
}

/** Highest score first; ties go to the song added earliest. The queue is at most ~50 songs, so sorting in JS is fine. */
export function rankQueue<T extends QueueItemRow>(items: T[]): T[] {
  const scores = new Map(items.map((i) => [i.id, scoreOf(i).score]))
  return [...items].sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || a.createdAt.getTime() - b.createdAt.getTime())
}

export function toQueueItem(row: QueueItemRow, userId: string) {
  const { votes, addedBy, ...item } = row
  return {
    ...item,
    ...scoreOf(row),
    myVote: votes.find((v) => v.userId === userId)?.value ?? null,
    addedBy: publicUser(addedBy),
  }
}

/** More than half of the people in the space, and at least 2 votes. */
export function skipThreshold(peoplePresent: number) {
  return Math.max(2, Math.floor(peoplePresent / 2) + 1)
}

// Locks the space row until the transaction ends, so queue changes and "next" in one space run one at a time.
export function lockSpace(tx: Prisma.TransactionClient, spaceId: string) {
  return tx.$queryRaw`SELECT id FROM "Space" WHERE id = ${spaceId} FOR UPDATE`
}

/**
 * Moves the top-ranked song to "now playing". Used by the host's next/skip and by the room's skip vote.
 * expectedCurrentId: the song the caller thinks is playing. If something else already moved on,
 * nothing changes, so two triggers at once (song end + skip) only advance one song.
 * skipReason: set when the current song is being skipped rather than ending on its own (host insights).
 */
export function advanceQueue(spaceId: string, expectedCurrentId: string | null | undefined, skipReason?: 'host' | 'room') {
  return db.$transaction(async (tx) => {
    await lockSpace(tx, spaceId)
    const space = await tx.space.findUniqueOrThrow({ where: { id: spaceId }, include: { currentItem: { include: queueItemInclude } } })
    if (expectedCurrentId !== undefined && expectedCurrentId !== space.currentItemId) {
      return { advanced: false, nowPlaying: space.currentItem, startedAt: space.currentStartedAt }
    }

    if (skipReason && space.currentItemId) {
      await tx.queueItem.update({ where: { id: space.currentItemId }, data: { skipReason } })
    }
    const waiting = await tx.queueItem.findMany({ where: { spaceId, played: false }, include: queueItemInclude })
    const top = rankQueue(waiting)[0]
    const now = new Date()
    await tx.space.update({ where: { id: spaceId }, data: { currentItemId: top?.id ?? null, currentStartedAt: top ? now : null } })
    if (!top) return { advanced: true, nowPlaying: null, startedAt: null }
    const nowPlaying = await tx.queueItem.update({ where: { id: top.id }, data: { played: true, playedAt: now }, include: queueItemInclude })
    return { advanced: true, nowPlaying, startedAt: now }
  })
}
