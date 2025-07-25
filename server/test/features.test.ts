import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRO_DOWNVOTE_WEIGHT } from '../src/config.js'
import { addSongs, as, db, makeSpace, makeUser, resetDb } from './helpers.js'

vi.mock('../src/spotify.js', async (original) => ({
  ...(await original<typeof import('../src/spotify.js')>()),
  getTrack: async (trackId: string) => ({ trackId, trackUri: `spotify:track:${trackId}`, title: 'T', artists: ['A'], albumArtUrl: null, durationMs: 1000 }),
}))

beforeEach(resetDb)

const monthAhead = () => new Date(Date.now() + 30 * 86400_000)
const voteOn = (userId: string, spaceId: string, itemId: string, value: 1 | -1 = 1) =>
  as(userId).post(`/api/spaces/${spaceId}/queue/${itemId}/vote`).send({ value })
const queueOf = async (userId: string, spaceId: string) => (await as(userId).get(`/api/spaces/${spaceId}/queue`)).body

describe('downvotes (phase 16)', () => {
  it('weights downvotes on a Pro user\'s song by PRO_DOWNVOTE_WEIGHT', async () => {
    expect(PRO_DOWNVOTE_WEIGHT).toBe(0.4)
    const { space } = await makeSpace()
    const free = await makeUser()
    const pro = await makeUser({ isPaid: true, paidUntil: monthAhead() })
    const [freeSong] = await addSongs(space.id, free.id, 1)
    const proSong = await db.queueItem.create({
      data: { spaceId: space.id, addedById: pro.id, trackId: 'pro'.padEnd(22, '0'), trackUri: 'x', title: 'Pro song', artists: [], durationMs: 1 },
    })
    const voters = await Promise.all([0, 1, 2, 3, 4, 5].map(() => makeUser()))
    // Both songs: 2 up, 4 down.
    for (const [i, v] of voters.entries()) {
      await voteOn(v.id, space.id, freeSong.id, i < 2 ? 1 : -1)
      await voteOn(v.id, space.id, proSong.id, i < 2 ? 1 : -1)
    }

    const { queue } = await queueOf(free.id, space.id)
    const byId = Object.fromEntries(queue.map((q: { id: string }) => [q.id, q]))
    expect(byId[freeSong.id]).toMatchObject({ upvotes: 2, downvotes: 4, score: -2, protected: false })
    expect(byId[proSong.id]).toMatchObject({ upvotes: 2, downvotes: 4, score: 0.4, protected: true })
    expect(queue[0].id).toBe(proSong.id) // ranked by score

    // "Play next" uses the same ranking.
    expect((await as(space.hostId).post(`/api/spaces/${space.id}/next`)).body.nowPlaying.id).toBe(proSong.id)
  })

  it('loses the protection when the Pro subscription has expired', async () => {
    const { space } = await makeSpace()
    const lapsed = await makeUser({ isPaid: true, paidUntil: new Date(Date.now() - 1000) })
    const [song] = await addSongs(space.id, lapsed.id, 1)
    await voteOn((await makeUser()).id, space.id, song.id, -1)
    expect((await queueOf(lapsed.id, space.id)).queue[0]).toMatchObject({ score: -1, protected: false })
  })

  it('uses the vote quota, and switching up→down costs another vote', async () => {
    const { space, host } = await makeSpace()
    const [a, b] = await addSongs(space.id, host.id, 2)
    const voter = await makeUser()
    expect((await voteOn(voter.id, space.id, a.id, -1)).body.quota.votesUsed).toBe(1)
    expect((await voteOn(voter.id, space.id, a.id, -1)).status).toBe(409) // same direction again
    expect((await voteOn(voter.id, space.id, a.id, 1)).body.quota.votesUsed).toBe(2) // switched
    await voteOn(voter.id, space.id, b.id, -1)

    const { queue } = await queueOf(voter.id, space.id)
    expect(queue.find((q: { id: string }) => q.id === a.id)).toMatchObject({ upvotes: 1, downvotes: 0, myVote: 1 })
    expect(queue.find((q: { id: string }) => q.id === b.id)).toMatchObject({ downvotes: 1, myVote: -1 })
  })
})

describe('recently played (phase 12)', () => {
  it('lists played songs newest first, without the one playing now', async () => {
    const { space, host } = await makeSpace()
    const [a, b, c] = await addSongs(space.id, host.id, 3)
    const next = () => as(host.id).post(`/api/spaces/${space.id}/next`)
    await next() // a
    await next() // b
    await next() // c, now playing
    const { body } = await as(host.id).get(`/api/spaces/${space.id}/history`)
    expect(body.map((i: { id: string }) => i.id)).toEqual([b.id, a.id])
    expect(body.map((i: { id: string }) => i.id)).not.toContain(c.id)
  })
})

describe('host settings (phase 18)', () => {
  it('applies the queue size, locked queue and vote limit', async () => {
    const { space, host } = await makeSpace()
    const guest = await makeUser({ isGuest: true })
    const settings = (body: object, userId = host.id) => as(userId).patch(`/api/spaces/${space.id}`).send(body)

    expect((await settings({ maxQueue: 5 }, guest.id)).status).toBe(403)
    expect((await settings({ maxQueue: 2 })).status).toBe(400) // below the allowed range
    expect((await settings({ hostId: guest.id })).status).toBe(400) // unknown fields refused
    expect((await settings({ maxQueue: 5, voteLimit: 2 })).status).toBe(200)

    const add = (n: number, userId = guest.id) => as(userId).post(`/api/spaces/${space.id}/queue`).send({ trackId: `s${n}`.padEnd(22, '0') })
    for (let n = 0; n < 5; n++) expect((await add(n)).status).toBe(201)
    expect((await add(5)).status).toBe(422)

    const { queue, quota, settings: s } = await queueOf(guest.id, space.id)
    expect(s).toEqual({ maxQueue: 5, voteLimit: 2, queueLocked: false })
    expect(quota.limit).toBe(2)
    await voteOn(guest.id, space.id, queue[0].id)
    expect((await voteOn(guest.id, space.id, queue[1].id)).body.quota.lockedUntil).not.toBeNull() // 2nd vote locks

    await settings({ queueLocked: true, maxQueue: 50 })
    expect((await add(6)).status).toBe(403)
    expect((await add(7, host.id)).status).toBe(201) // the host can still add
  })

  it('starts the cooldown right away when the limit drops below votes already used', async () => {
    const { space, host } = await makeSpace()
    const [a, b, c, d] = await addSongs(space.id, host.id, 4)
    const voter = await makeUser()
    for (const s of [a, b, c]) await voteOn(voter.id, space.id, s.id)
    await as(host.id).patch(`/api/spaces/${space.id}`).send({ voteLimit: 2 })

    expect((await queueOf(voter.id, space.id)).quota).toMatchObject({ votesLeft: 0, lockedUntil: null })
    const res = await voteOn(voter.id, space.id, d.id)
    expect(res.status).toBe(429)
    expect(res.body.lockedUntil).toBeTruthy()
    expect((await queueOf(voter.id, space.id)).quota.lockedUntil).not.toBeNull() // the lock was saved
  })
})

describe('bans (phase 15)', () => {
  it('blocks a removed person everywhere and drops their votes', async () => {
    const { space, host } = await makeSpace()
    const [song] = await addSongs(space.id, host.id, 1)
    const troll = await makeUser({ isGuest: true })
    await voteOn(troll.id, space.id, song.id, -1)

    expect((await as(troll.id).post(`/api/spaces/${space.id}/bans`).send({ userId: host.id })).status).toBe(403)
    expect((await as(host.id).post(`/api/spaces/${space.id}/bans`).send({ userId: host.id })).status).toBe(400)
    expect((await as(host.id).post(`/api/spaces/${space.id}/bans`).send({ userId: troll.id })).status).toBe(201)

    expect(await db.vote.count({ where: { userId: troll.id } })).toBe(0)
    for (const res of [
      await as(troll.id).get(`/api/spaces/${space.id}`),
      await as(troll.id).get(`/api/spaces/${space.id}/queue`),
      await as(troll.id).post(`/api/spaces/${space.id}/queue`).send({ trackId: 'x'.repeat(22) }),
      await voteOn(troll.id, space.id, song.id),
      await as(troll.id).post(`/api/spaces/${space.id}/skip-vote`),
    ]) {
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('banned')
    }

    const bans = (await as(host.id).get(`/api/spaces/${space.id}/bans`)).body
    expect(bans.map((b: { id: string }) => b.id)).toEqual([troll.id])
    await as(host.id).delete(`/api/spaces/${space.id}/bans/${troll.id}`)
    expect((await as(troll.id).get(`/api/spaces/${space.id}/queue`)).status).toBe(200)
  })
})

describe('vote to skip (phase 17)', () => {
  it('skips once the threshold is reached, exactly one song, with no Pro protection', async () => {
    const { space, host } = await makeSpace()
    const pro = await makeUser({ isPaid: true, paidUntil: monthAhead() })
    const [a, b, c] = await addSongs(space.id, pro.id, 3)
    await as(host.id).post(`/api/spaces/${space.id}/next`) // a plays
    const [u1, u2, u3] = await Promise.all([makeUser(), makeUser(), makeUser()])
    const skip = (userId: string) => as(userId).post(`/api/spaces/${space.id}/skip-vote`)

    // Nobody is connected by socket in this test, so the threshold is the minimum: 2.
    expect((await skip(u1.id)).body).toMatchObject({ votes: 1, needed: 2, skipped: false })
    expect((await skip(u1.id)).status).toBe(409)
    expect((await queueOf(u1.id, space.id)).skip).toEqual({ votes: 1, needed: 2, voted: true })

    expect((await skip(u2.id)).body).toMatchObject({ votes: 2, skipped: true })
    const after = await queueOf(u1.id, space.id)
    expect(after.nowPlaying.id).toBe(b.id)
    expect(after.queue.map((q: { id: string }) => q.id)).toEqual([c.id])
    expect(after.skip).toEqual({ votes: 0, needed: 2, voted: false }) // fresh count for the new song

    // Votes start again from zero for the new song: one more vote alone doesn't skip it.
    expect((await skip(u3.id)).body).toMatchObject({ votes: 1, skipped: false })
    expect((await queueOf(u1.id, space.id)).nowPlaying.id).toBe(b.id)
    expect(await db.skipVote.count({ where: { queueItemId: a.id } })).toBe(2) // a's votes stay with a
  })
})
