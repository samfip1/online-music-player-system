import request from 'supertest'
import { app } from '../src/app.js'
import { signSession } from '../src/auth.js'
import { db } from '../src/db.js'

export { db }

export async function resetDb() {
  await db.$executeRaw`TRUNCATE "PresenceSample", "Refund", "Payment", "SkipVote", "SpaceBan", "Vote", "VoteQuota", "QueueItem", "Space", "User" CASCADE`
}

export function makeUser(
  data: { isGuest?: boolean; isPaid?: boolean; paidUntil?: Date | null; spotifyId?: string; displayName?: string; proPlan?: string } = {},
) {
  return db.user.create({ data: { displayName: 'Test user', spotifyId: data.isGuest ? null : crypto.randomUUID(), ...data } })
}

export async function makeSpace() {
  const host = await makeUser()
  const space = await db.space.create({ data: { name: 'Test space', hostId: host.id } })
  return { host, space }
}

/** Adds songs straight to the database (no Spotify call). createdAt is spaced out so order is predictable. */
export async function addSongs(spaceId: string, addedById: string, count: number) {
  const items = []
  for (let i = 0; i < count; i++) {
    items.push(
      await db.queueItem.create({
        data: {
          spaceId,
          addedById,
          trackId: `track${i}`.padEnd(22, '0'),
          trackUri: `spotify:track:track${i}`,
          title: `Song ${i}`,
          artists: ['Artist'],
          durationMs: 180_000,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        },
      }),
    )
  }
  return items
}

/** A Supertest client logged in as this user. */
export function as(userId: string) {
  const cookie = `sid=${signSession(userId)}`
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
  }
}
