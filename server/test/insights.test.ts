import { createHmac } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/app.js'
import { addSongs, as, db, makeSpace, makeUser, resetDb } from './helpers.js'
import { testEnv } from './env.js'

beforeEach(resetDb)
afterEach(() => vi.restoreAllMocks())

const monthAhead = () => new Date(Date.now() + 30 * 86400_000)
const insights = (userId: string, spaceId?: string) => as(userId).get(`/api/host/insights${spaceId ? `?spaceId=${spaceId}` : ''}`)

function webhook(event: string, payload: object) {
  const body = JSON.stringify({ event, payload })
  const signature = createHmac('sha256', testEnv.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex')
  return request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(body)
}

describe('host insights (phase 22)', () => {
  it('gives every host the free numbers, and locks the rest without Pro Host', async () => {
    const { space, host } = await makeSpace()
    await addSongs(space.id, host.id, 2)
    await as(host.id).post(`/api/spaces/${space.id}/next`)
    await db.space.update({ where: { id: space.id }, data: { peakPeople: 7 } })

    // Plain Pro isn't enough: insights are the Pro Host perk.
    await db.user.update({ where: { id: host.id }, data: { isPaid: true, paidUntil: monthAhead(), proPlan: 'pro' } })
    const { body } = await insights(host.id)
    expect(body.locked).toBe(true)
    expect(body.details).toBeNull()
    expect(body.spaces).toEqual([expect.objectContaining({ id: space.id, songsPlayed: 1, peakPeople: 7 })])

    const guest = await makeUser({ isGuest: true })
    expect((await insights(guest.id)).status).toBe(403)
  })

  it("never shows another host's space", async () => {
    const { space } = await makeSpace()
    const other = await makeUser({ isPaid: true, paidUntil: monthAhead(), proPlan: 'pro_host' })
    expect((await insights(other.id, space.id)).status).toBe(404)
    expect((await insights(other.id)).body.spaces).toEqual([])
  })

  it('shows top songs, skips, reactions and top requesters to Pro Host, with no voting history', async () => {
    const { space, host } = await makeSpace()
    await db.user.update({ where: { id: host.id }, data: { isPaid: true, paidUntil: monthAhead(), proPlan: 'pro_host' } })
    const [ria, kabir] = [await makeUser({ displayName: 'Ria' }), await makeUser({ displayName: 'Kabir', isGuest: true })]
    const [a, b, c, d] = await addSongs(space.id, ria.id, 4)
    await db.queueItem.update({ where: { id: d.id }, data: { addedById: kabir.id } })
    const vote = (userId: string, itemId: string, value: 1 | -1) => as(userId).post(`/api/spaces/${space.id}/queue/${itemId}/vote`).send({ value })
    await vote(kabir.id, a.id, 1)
    await vote(host.id, a.id, 1)
    await vote(kabir.id, b.id, -1)

    await as(host.id).post(`/api/spaces/${space.id}/next`).send({ currentItemId: null }) // a plays
    await as(host.id).post(`/api/spaces/${space.id}/next`).send({ currentItemId: a.id, reason: 'skipped' }) // host skips a
    const playing = (await db.space.findUniqueOrThrow({ where: { id: space.id } })).currentItemId!
    await as(kabir.id).post(`/api/spaces/${space.id}/skip-vote`)
    await as(ria.id).post(`/api/spaces/${space.id}/skip-vote`) // room skips the next one
    await as(host.id).post(`/api/spaces/${space.id}/next`).send({ currentItemId: (await db.space.findUniqueOrThrow({ where: { id: space.id } })).currentItemId, reason: 'ended' })
    await db.queueItem.update({ where: { id: c.id }, data: { reactions: 12 } })
    await db.presenceSample.createMany({ data: [{ spaceId: space.id, people: 3 }, { spaceId: space.id, people: 5 }] })

    const { body } = await insights(host.id, space.id)
    expect(body.locked).toBe(false)
    const t = body.details.totals
    expect(t).toMatchObject({ parties: 1, songsAdded: 4, upvotes: 2, downvotes: 1, reactions: 12, skippedByHost: 1, skippedByRoom: 1, participants: 2 })
    expect(body.details.topSongs[0]).toMatchObject({ id: a.id, score: 2 })
    expect(body.details.mostDownvoted[0]).toMatchObject({ id: b.id, downvotes: 1 })
    expect(body.details.mostReactions[0]).toMatchObject({ id: c.id, reactions: 12 })
    expect(body.details.skipped.map((s: { id: string; skipReason: string }) => [s.id, s.skipReason]).sort()).toEqual(
      [[a.id, 'host'], [playing, 'room']].sort(),
    )
    expect(body.details.topRequesters[0]).toMatchObject({ user: { displayName: 'Ria' }, songs: 3, upvotes: 2 })
    expect(body.details.crowd.map((c: { people: number }) => c.people)).toEqual([3, 5])
    expect(body.details.voteTimeline.reduce((n: number, v: { up: number }) => n + v.up, 0)).toBe(2)
    // Privacy: nothing in the response says who cast which vote (no voter ids, no per-song vote lists).
    expect(JSON.stringify(body)).not.toContain('userId')
    expect(body.details.topSongs[0]).not.toHaveProperty('votes')
  })
})

describe('Pro Host plan (phase 22)', () => {
  it('takes the tier from the plan Razorpay reports, and upgrading cancels the old subscription', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const user = await makeUser()
    const end = Math.floor(Date.now() / 1000) + 30 * 86400
    const sub = (id: string, plan_id: string, notes: object) => ({ id, plan_id, status: 'active', current_end: end, notes })

    await webhook('subscription.charged', { subscription: { entity: sub('sub_pro', 'plan_test', { userId: user.id }) } })
    expect((await as(user.id).get('/api/auth/me')).body).toMatchObject({ isPro: true, isProHost: false })

    await webhook('subscription.activated', { subscription: { entity: sub('sub_host', 'plan_host_test', { userId: user.id, replaces: 'sub_pro' }) } })
    expect((await as(user.id).get('/api/auth/me')).body).toMatchObject({ isPro: true, isProHost: true, hostPlanEnabled: true })
    const cancel = fetchSpy.mock.calls.find(([url]) => String(url).includes('/subscriptions/sub_pro/cancel'))
    expect(cancel).toBeTruthy()
    expect(JSON.parse(String(cancel![1]?.body))).toEqual({ cancel_at_cycle_end: 0 }) // stop now, no double charging

    // The old subscription ending afterwards doesn't touch the new one.
    await webhook('subscription.cancelled', { subscription: { entity: { ...sub('sub_pro', 'plan_test', { userId: user.id }), status: 'cancelled' } } })
    expect((await as(user.id).get('/api/auth/me')).body.isProHost).toBe(true)
  })

  it('checks out the right plan and refuses buying the same plan twice', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ id: `sub_${Math.random()}` })))
    const user = await makeUser({ isPaid: true, paidUntil: monthAhead(), proPlan: 'pro' })
    await db.user.update({ where: { id: user.id }, data: { razorpaySubscriptionId: 'sub_old' } })

    expect((await as(user.id).post('/api/billing/checkout').send({ plan: 'pro' })).status).toBe(409)
    expect((await as(user.id).post('/api/billing/checkout').send({ plan: 'gold' })).status).toBe(400)
    expect((await as(user.id).post('/api/billing/checkout').send({ plan: 'pro_host' })).status).toBe(201)
    const created = JSON.parse(String(fetchSpy.mock.calls.at(-1)![1]?.body))
    expect(created).toMatchObject({ plan_id: 'plan_host_test', notes: { userId: user.id, replaces: 'sub_old' } })
    // The new one is pending; the running subscription stays active (and cancellable) until it's replaced.
    const saved = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(saved.razorpaySubscriptionId).toBe('sub_old')
    expect(saved.pendingSubscriptionId).toMatch(/^sub_/)
    expect((await as(user.id).get('/api/auth/me')).body.pendingPayment).toBe(true)
  })

  it('syncs a checkout that Razorpay activated later, when no webhook arrives', async () => {
    const end = Math.floor(Date.now() / 1000) + 30 * 86400
    const user = await makeUser()
    await db.user.update({ where: { id: user.id }, data: { pendingSubscriptionId: 'sub_late' } })
    const answers: Record<string, object> = {
      '/subscriptions/sub_late': { id: 'sub_late', plan_id: 'plan_host_test', status: 'active', current_end: end, notes: { userId: user.id } },
      '/invoices?subscription_id=sub_late': { items: [{ payment_id: 'pay_late', status: 'paid' }] },
      '/payments/pay_late': { id: 'pay_late', amount: 4900, currency: 'INR', status: 'captured', created_at: end - 30 * 86400 },
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const path = String(url).replace('https://api.razorpay.com/v1', '')
      return new Response(JSON.stringify(answers[path] ?? {}))
    })

    const { body } = await as(user.id).post('/api/billing/sync')
    expect(body).toEqual({ pending: false, active: true, proPlan: 'pro_host' })
    expect((await as(user.id).get('/api/auth/me')).body).toMatchObject({ isProHost: true, pendingPayment: false, hasSubscription: true })
    expect(await db.payment.findUnique({ where: { id: 'pay_late' } })).toMatchObject({ amount: 4900, userId: user.id })
    // Running it again changes nothing (the payment isn't counted twice).
    await as(user.id).post('/api/billing/sync')
    expect(await db.payment.count()).toBe(1)
  })

  it('stops checking an abandoned checkout', async () => {
    const user = await makeUser()
    await db.user.update({ where: { id: user.id }, data: { pendingSubscriptionId: 'sub_gone' } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'sub_gone', plan_id: 'plan_test', status: 'created', current_end: null, created_at: Math.floor(Date.now() / 1000) - 2 * 3600, notes: {} })),
    )
    expect((await as(user.id).post('/api/billing/sync')).body).toEqual({ pending: false, active: false, proPlan: null })
  })

  it('counts both plans in admin MRR, including Pro members from before tiers existed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      new Response(JSON.stringify({ item: { amount: String(url).includes('plan_host_test') ? 4900 : 3900 } })),
    )
    const admin = await makeUser({ spotifyId: 'admin-spotify-id' })
    await makeUser({ isPaid: true, paidUntil: monthAhead() }) // no proPlan recorded: counts as Pro
    await makeUser({ isPaid: true, paidUntil: monthAhead(), proPlan: 'pro' })
    await makeUser({ isPaid: true, paidUntil: monthAhead(), proPlan: 'pro_host' })
    await makeUser({ isPaid: true, paidUntil: new Date(Date.now() - 1000), proPlan: 'pro_host' }) // expired
    const { revenue } = (await as(admin.id).get('/api/admin/stats')).body
    expect(revenue).toMatchObject({ activePro: 2, activeProHost: 1, pricePaise: 3900, hostPricePaise: 4900, mrrPaise: 2 * 3900 + 4900 })
  })
})
