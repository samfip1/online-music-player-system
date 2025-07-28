import { createHmac } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/app.js'
import { addSongs, as, makeSpace, makeUser, resetDb } from './helpers.js'
import { testEnv } from './env.js'

beforeEach(resetDb)
afterEach(() => vi.restoreAllMocks())

const admin = () => makeUser({ spotifyId: 'admin-spotify-id', displayName: 'Admin' })

function webhook(event: string, payload: object) {
  const body = JSON.stringify({ event, payload })
  const signature = createHmac('sha256', testEnv.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex')
  return request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(body)
}

describe('admin dashboard', () => {
  it('is a plain 404 for everyone who is not an admin', async () => {
    const guest = await makeUser({ isGuest: true })
    const host = await makeUser()
    for (const user of [guest, host]) {
      expect((await as(user.id).get('/api/admin/stats')).status).toBe(404)
      expect((await as(user.id).get('/api/admin/live')).status).toBe(404)
      expect((await as(user.id).get('/api/auth/me')).body.isAdmin).toBe(false)
    }
    expect((await request(app).get('/api/admin/stats')).status).toBe(401)
    expect((await as((await admin()).id).get('/api/auth/me')).body.isAdmin).toBe(true)
  })

  it('counts totals, and revenue net of refunds with repeated webhooks counted once', async () => {
    // The plan price comes from Razorpay; fake that one call.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ item: { amount: 3900 } })))
    const me = await admin()
    const payer = await makeUser({ displayName: 'Payer' })
    const { space, host } = await makeSpace()
    await addSongs(space.id, host.id, 2)
    await as(host.id).post(`/api/spaces/${space.id}/next`)
    await makeUser({ isGuest: true })

    const now = Math.floor(Date.now() / 1000)
    const charged = {
      subscription: { entity: { id: 'sub_1', status: 'active', current_end: now + 30 * 86400, notes: { userId: payer.id } } },
      payment: { entity: { id: 'pay_1', amount: 3900, currency: 'INR', status: 'captured', created_at: now } },
    }
    await webhook('subscription.charged', charged)
    await webhook('subscription.charged', charged) // delivered twice
    const refund = { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 1000, created_at: now } } }
    await webhook('refund.processed', refund)
    await webhook('refund.processed', refund)

    const { body, status } = await as(me.id).get('/api/admin/stats')
    expect(status).toBe(200)
    expect(body.totals.hosts).toEqual({ today: 3, week: 3, all: 3 }) // admin, payer, host
    expect(body.totals.guests.all).toBe(1)
    expect(body.totals.plays.today).toBe(1)
    expect(body.revenue).toMatchObject({ activePro: 1, pricePaise: 3900, mrrPaise: 3900, thisMonthPaise: 2900, allTimePaise: 2900 })
    expect(body.payments).toEqual([expect.objectContaining({ id: 'pay_1', amountPaise: 3900, refundedPaise: 1000, user: { displayName: 'Payer', email: null } })])
    expect(body.daily).toHaveLength(30)
    expect(body.daily.at(-1)).toMatchObject({ users: 4, plays: 1, revenuePaise: 2900 })
  })
})
