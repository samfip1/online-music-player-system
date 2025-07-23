import { createHmac } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/app.js'
import { isPro } from '../src/auth.js'
import { as, db, makeUser, resetDb } from './helpers.js'
import { testEnv } from './env.js'

beforeEach(resetDb)
afterEach(() => vi.restoreAllMocks())

function webhook(event: string, subscription: object, secret = testEnv.RAZORPAY_WEBHOOK_SECRET) {
  const body = JSON.stringify({ event, payload: { subscription: { entity: subscription } } })
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  return request(app)
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', signature)
    .send(body)
}

describe('Razorpay webhook', () => {
  it('turns Pro on when a charge succeeds, and off when the subscription ends', async () => {
    const user = await makeUser()
    const end = Math.floor(Date.now() / 1000) + 30 * 86400
    const sub = { id: 'sub_1', status: 'active', current_end: end, notes: { userId: user.id } }

    expect((await webhook('subscription.charged', sub)).status).toBe(200)
    let saved = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(isPro(saved)).toBe(true)
    expect(saved.paidUntil?.getTime()).toBe(end * 1000)

    // Delivered twice: still fine.
    expect((await webhook('subscription.charged', sub)).status).toBe(200)

    await webhook('subscription.cancelled', { ...sub, status: 'cancelled' })
    saved = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(isPro(saved)).toBe(false)
  })

  it('rejects a forged signature and changes nothing', async () => {
    const user = await makeUser()
    const sub = { id: 'sub_1', status: 'active', current_end: 9999999999, notes: { userId: user.id } }
    expect((await webhook('subscription.charged', sub, 'wrong-secret')).status).toBe(400)
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isPaid).toBe(false)
  })

  it('does not let an old subscription ending cancel a newer one', async () => {
    const user = await makeUser()
    const end = Math.floor(Date.now() / 1000) + 30 * 86400
    await webhook('subscription.charged', { id: 'sub_new', status: 'active', current_end: end, notes: { userId: user.id } })
    await webhook('subscription.cancelled', { id: 'sub_old', status: 'cancelled', current_end: null, notes: { userId: user.id } })
    expect(isPro(await db.user.findUniqueOrThrow({ where: { id: user.id } }))).toBe(true)
  })

  it('cancels renewal once, keeping Pro until the paid period ends', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'active' })))
    const paidUntil = new Date(Date.now() + 10 * 86400_000)
    const user = await makeUser({ isPaid: true, paidUntil })
    await db.user.update({ where: { id: user.id }, data: { razorpaySubscriptionId: 'sub_1' } })

    expect((await as(user.id).post('/api/billing/cancel')).status).toBe(204)
    expect(fetchSpy.mock.calls[0][0]).toContain('/subscriptions/sub_1/cancel')
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({ cancel_at_cycle_end: 1 })

    const me = (await as(user.id).get('/api/auth/me')).body
    expect(me).toMatchObject({ isPro: true, hasSubscription: false })
    expect((await as(user.id).post('/api/billing/cancel')).status).toBe(404) // nothing left to cancel
  })

  it('does not let guests start a checkout', async () => {
    const guest = await makeUser({ isGuest: true })
    expect((await as(guest.id).post('/api/billing/checkout')).status).toBe(403)
  })
})

describe('Spotify login redirect', () => {
  it('remembers a safe return path and ignores unsafe ones', async () => {
    const ok = await request(app).get('/api/auth/spotify/login?returnTo=/space/abc123')
    expect(ok.headers['set-cookie']?.join()).toContain('spotify_return=%2Fspace%2Fabc123')

    for (const bad of ['//evil.com', 'https://evil.com', '/space/../..%2F']) {
      const res = await request(app).get(`/api/auth/spotify/login?returnTo=${encodeURIComponent(bad)}`)
      expect(res.headers['set-cookie']?.join()).not.toContain('spotify_return=')
    }
  })
})
