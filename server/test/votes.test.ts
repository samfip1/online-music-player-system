import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COOLDOWN_FREE_MS, COOLDOWN_PAID_MS, VOTE_LIMIT } from '../src/config.js'
import { addSongs, as, db, makeSpace, makeUser, resetDb } from './helpers.js'

const START = new Date('2026-01-01T12:00:00Z')

// Only Date is faked, so the database driver's real timers keep working.
beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
})
afterEach(() => {
  vi.useRealTimers()
})

async function setup(user: { isPaid?: boolean; paidUntil?: Date | null } = {}) {
  const { host, space } = await makeSpace()
  const voter = await makeUser({ isGuest: !user.isPaid, ...user })
  const songs = await addSongs(space.id, host.id, 8)
  const client = as(voter.id)
  const vote = (i: number) => client.post(`/api/spaces/${space.id}/queue/${songs[i].id}/vote`)
  const unvote = (i: number) => client.delete(`/api/spaces/${space.id}/queue/${songs[i].id}/vote`)
  const queue = () => client.get(`/api/spaces/${space.id}/queue`)
  return { space, voter, vote, unvote, queue }
}

describe('vote limit', () => {
  it(`allows ${VOTE_LIMIT} votes, then locks for 5 minutes`, async () => {
    const { vote } = await setup()
    for (let i = 0; i < VOTE_LIMIT - 1; i++) {
      const res = await vote(i)
      expect(res.status).toBe(201)
      expect(res.body.quota).toMatchObject({ votesUsed: i + 1, votesLeft: VOTE_LIMIT - i - 1, lockedUntil: null })
    }

    const fifth = await vote(VOTE_LIMIT - 1)
    expect(fifth.status).toBe(201)
    expect(fifth.body.quota.votesLeft).toBe(0)
    expect(new Date(fifth.body.quota.lockedUntil).getTime()).toBe(START.getTime() + COOLDOWN_FREE_MS)
  })

  it('returns 429 with lockedUntil while locked, and the vote is not saved', async () => {
    const { vote, voter } = await setup()
    for (let i = 0; i < VOTE_LIMIT; i++) await vote(i)

    vi.setSystemTime(START.getTime() + COOLDOWN_FREE_MS - 1000)
    const res = await vote(VOTE_LIMIT)
    expect(res.status).toBe(429)
    expect(new Date(res.body.lockedUntil).getTime()).toBe(START.getTime() + COOLDOWN_FREE_MS)
    expect(await db.vote.count({ where: { userId: voter.id } })).toBe(VOTE_LIMIT)
  })

  it('gives a fresh set of votes once the cooldown ends', async () => {
    const { vote, queue } = await setup()
    for (let i = 0; i < VOTE_LIMIT; i++) await vote(i)

    vi.setSystemTime(START.getTime() + COOLDOWN_FREE_MS)
    // The GET shows the reset before any new vote is cast.
    expect((await queue()).body.quota).toMatchObject({ votesUsed: 0, votesLeft: VOTE_LIMIT, lockedUntil: null })

    const res = await vote(VOTE_LIMIT)
    expect(res.status).toBe(201)
    expect(res.body.quota).toMatchObject({ votesUsed: 1, votesLeft: VOTE_LIMIT - 1 })
  })

  it('uses a 4-minute cooldown for paid users', async () => {
    const { vote } = await setup({ isPaid: true, paidUntil: new Date('2026-02-01T00:00:00Z') })
    let res
    for (let i = 0; i < VOTE_LIMIT; i++) res = await vote(i)
    expect(new Date(res!.body.quota.lockedUntil).getTime()).toBe(START.getTime() + COOLDOWN_PAID_MS)
  })

  it('treats an expired subscription as free (5-minute cooldown)', async () => {
    const { vote } = await setup({ isPaid: true, paidUntil: new Date('2025-12-01T00:00:00Z') })
    let res
    for (let i = 0; i < VOTE_LIMIT; i++) res = await vote(i)
    expect(new Date(res!.body.quota.lockedUntil).getTime()).toBe(START.getTime() + COOLDOWN_FREE_MS)
  })

  it('does not refund a vote when it is removed', async () => {
    const { vote, unvote } = await setup()
    await vote(0)
    await vote(1)
    await vote(2)

    const removed = await unvote(0)
    expect(removed.status).toBe(200)
    expect(removed.body.quota).toMatchObject({ votesUsed: 3, votesLeft: VOTE_LIMIT - 3 })

    // Re-voting the same song still costs a vote, and the limit still hits at 5 casts in total.
    expect((await vote(0)).body.quota.votesUsed).toBe(4)
    expect((await vote(3)).body.quota.votesLeft).toBe(0)
    expect((await vote(4)).status).toBe(429)
  })

  it('rejects a second vote on the same song without using up a vote', async () => {
    const { vote, queue } = await setup()
    await vote(0)
    expect((await vote(0)).status).toBe(409)
    expect((await queue()).body.quota.votesUsed).toBe(1)
  })

  it('never goes over the limit with parallel requests', async () => {
    const { vote, voter } = await setup()
    const results = await Promise.all(Array.from({ length: VOTE_LIMIT + 3 }, (_, i) => vote(i)))
    const statuses = results.map((r) => r.status).sort()
    expect(statuses.filter((s) => s === 201)).toHaveLength(VOTE_LIMIT)
    expect(statuses.filter((s) => s === 429)).toHaveLength(3)
    expect(await db.vote.count({ where: { userId: voter.id } })).toBe(VOTE_LIMIT)
  })

  it('keeps quotas separate per space', async () => {
    const { vote, voter } = await setup()
    for (let i = 0; i < VOTE_LIMIT; i++) await vote(i)

    const other = await makeSpace()
    const [song] = await addSongs(other.space.id, other.host.id, 1)
    const res = await as(voter.id).post(`/api/spaces/${other.space.id}/queue/${song.id}/vote`)
    expect(res.status).toBe(201)
  })
})
