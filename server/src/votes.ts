import { isPro } from './auth.js'
import { COOLDOWN_FREE_MS, COOLDOWN_PAID_MS } from './config.js'
import { db } from './db.js'
import { HttpError } from './errors.js'
import type { User } from './generated/prisma/client.js'

export type Quota = { limit: number; votesUsed: number; votesLeft: number; lockedUntil: Date | null }

/**
 * The quota as it stands right now. A lock that has expired means a fresh set of votes:
 * the reset happens here, lazily, so no background job is needed.
 */
export function currentQuota(row: { votesUsed: number; lockedUntil: Date | null } | null, limit: number, now = new Date()): Quota {
  if (!row || (row.lockedUntil && row.lockedUntil <= now)) {
    return { limit, votesUsed: 0, votesLeft: limit, lockedUntil: null }
  }
  return { limit, votesUsed: row.votesUsed, votesLeft: Math.max(0, limit - row.votesUsed), lockedUntil: row.lockedUntil }
}

export async function getQuota(userId: string, spaceId: string, limit: number): Promise<Quota> {
  return currentQuota(await db.voteQuota.findUnique({ where: { userId_spaceId: { userId, spaceId } } }), limit)
}

const cooldownFor = (user: User) => (isPro(user) ? COOLDOWN_PAID_MS : COOLDOWN_FREE_MS)

/**
 * Upvote (+1) or downvote (−1). Both use the same quota. Switching an existing vote's direction
 * counts as a new vote, since removals are never refunded.
 */
export async function castVote(user: User, spaceId: string, queueItemId: string, value: 1 | -1): Promise<Quota> {
  const result = await db.$transaction(async (tx) => {
    const item = await tx.queueItem.findFirst({ where: { id: queueItemId, spaceId, played: false }, select: { id: true } })
    if (!item) throw new HttpError(404, 'Song is not in the queue')
    const { voteLimit } = await tx.space.findUniqueOrThrow({ where: { id: spaceId }, select: { voteLimit: true } })

    // Create the quota row if needed, then lock it. Parallel votes from the same user in this
    // space wait on this lock one by one, so they can never go over the limit together.
    await tx.$executeRaw`
      INSERT INTO "VoteQuota" ("userId", "spaceId") VALUES (${user.id}, ${spaceId}) ON CONFLICT DO NOTHING`
    const [row] = await tx.$queryRaw<{ votesUsed: number; lockedUntil: Date | null }[]>`
      SELECT "votesUsed", "lockedUntil" FROM "VoteQuota"
      WHERE "userId" = ${user.id} AND "spaceId" = ${spaceId} FOR UPDATE`

    const now = new Date()
    const quota = currentQuota(row, voteLimit, now)
    if (quota.lockedUntil) throw new HttpError(429, 'Out of votes', { lockedUntil: quota.lockedUntil })

    // The host lowered the limit below what this person already used: their cooldown starts now.
    // Returned (not thrown) so the lock is saved when the transaction commits.
    if (quota.votesLeft === 0) {
      const lockedUntil = new Date(now.getTime() + cooldownFor(user))
      await tx.voteQuota.update({ where: { userId_spaceId: { userId: user.id, spaceId } }, data: { lockedUntil } })
      return { lockedUntil }
    }

    const existing = await tx.vote.findUnique({ where: { userId_queueItemId: { userId: user.id, queueItemId } } })
    if (existing?.value === value) throw new HttpError(409, value > 0 ? 'You already voted for this song' : 'You already downvoted this song')
    if (existing) await tx.vote.update({ where: { id: existing.id }, data: { value } })
    else await tx.vote.create({ data: { userId: user.id, queueItemId, value } })

    const votesUsed = quota.votesUsed + 1
    const lockedUntil = votesUsed >= voteLimit ? new Date(now.getTime() + cooldownFor(user)) : null
    await tx.voteQuota.update({ where: { userId_spaceId: { userId: user.id, spaceId } }, data: { votesUsed, lockedUntil } })
    return { quota: currentQuota({ votesUsed, lockedUntil }, voteLimit, now) }
  })
  if ('lockedUntil' in result) throw new HttpError(429, 'Out of votes', { lockedUntil: result.lockedUntil })
  return result.quota
}

/** Removing a vote never refunds it: the quota is left untouched on purpose. */
export async function removeVote(userId: string, spaceId: string, queueItemId: string): Promise<void> {
  const { count } = await db.vote.deleteMany({ where: { userId, queueItemId, queueItem: { spaceId } } })
  if (count === 0) throw new HttpError(404, 'No vote to remove')
}
