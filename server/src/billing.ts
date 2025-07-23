import { createHmac, timingSafeEqual } from 'node:crypto'
import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { isPro, requireAuth } from './auth.js'
import { billingEnabled, env, hostPlanEnabled } from './config.js'
import { db } from './db.js'
import { HttpError } from './errors.js'

// Razorpay Subscriptions over plain fetch (no SDK needed for three calls).
// Paid status is only ever set from data Razorpay signed or that we fetched from Razorpay ourselves.

const RAZORPAY = 'https://api.razorpay.com/v1'

type Notes = { userId?: string; replaces?: string }
type Subscription = { id: string; plan_id: string; status: string; current_end: number | null; created_at?: number; notes: Notes | [] }

export type Tier = 'pro' | 'pro_host'

/** The tier comes from the plan Razorpay says was bought, never from the browser. */
const tierOf = (sub: Subscription): Tier => (env.RAZORPAY_HOST_PLAN_ID && sub.plan_id === env.RAZORPAY_HOST_PLAN_ID ? 'pro_host' : 'pro')
const notesOf = (sub: Subscription): Notes => (Array.isArray(sub.notes) ? {} : sub.notes)
type RazorpayPayment = { id: string; amount: number; currency: string; status: string; created_at: number }
type RazorpayRefund = { id: string; payment_id: string; amount: number; created_at: number }

const userIdOf = (sub: Subscription) => notesOf(sub).userId

/** Stores a captured payment for the admin revenue figures. Keyed by Razorpay's id, so repeats are ignored. */
async function recordPayment(payment: RazorpayPayment, userId: string | undefined) {
  if (payment.status !== 'captured') return
  const user = userId ? await db.user.findUnique({ where: { id: userId }, select: { id: true } }) : null
  await db.payment.upsert({
    where: { id: payment.id },
    create: { id: payment.id, userId: user?.id, amount: payment.amount, currency: payment.currency, createdAt: new Date(payment.created_at * 1000) },
    update: {},
  })
}

async function recordRefund(refund: RazorpayRefund) {
  // Only refunds of payments we know about (subscription payments) count toward revenue.
  if (!(await db.payment.findUnique({ where: { id: refund.payment_id }, select: { id: true } }))) return
  await db.refund.upsert({
    where: { id: refund.id },
    create: { id: refund.id, paymentId: refund.payment_id, amount: refund.amount, createdAt: new Date(refund.created_at * 1000) },
    update: {},
  })
}

async function razorpay<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const res = await fetch(RAZORPAY + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Razorpay ${method} ${path} failed (${res.status}): ${await res.text()}`)
  return (await res.json()) as T
}

function signatureMatches(secret: string, data: string | Buffer, signature: unknown): boolean {
  if (typeof signature !== 'string') return false
  const expected = Buffer.from(createHmac('sha256', secret).update(data).digest('hex'))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// ponytail: plan prices cached for the server's lifetime; restart after changing a price in Razorpay.
const planPrices = new Map<string, Promise<number | null>>()

/** A plan's monthly price in paise, from Razorpay (prices live there, not in code). */
export function getPlanPricePaise(tier: Tier = 'pro'): Promise<number | null> {
  const planId = tier === 'pro_host' ? env.RAZORPAY_HOST_PLAN_ID : env.RAZORPAY_PLAN_ID
  if (!billingEnabled || !planId) return Promise.resolve(null)
  if (!planPrices.has(planId)) {
    planPrices.set(
      planId,
      razorpay<{ item: { amount: number } }>('GET', `/plans/${planId}`)
        .then((plan) => plan.item.amount)
        .catch((err) => {
          console.error(err)
          planPrices.delete(planId) // try again next time
          return null
        }),
    )
  }
  return planPrices.get(planId)!
}

const ENDED = new Set(['cancelled', 'halted', 'completed', 'expired'])

/** Mirrors a Razorpay subscription onto the user who started it. */
async function applySubscription(sub: Subscription) {
  const userId = userIdOf(sub)
  const where = userId ? { id: userId } : { razorpaySubscriptionId: sub.id }
  if (sub.status === 'active' && sub.current_end) {
    await db.user.updateMany({
      where,
      data: { isPaid: true, paidUntil: new Date(sub.current_end * 1000), razorpaySubscriptionId: sub.id, proPlan: tierOf(sub) },
    })
    // It was the pending checkout: it's the active subscription now.
    await db.user.updateMany({ where: { ...where, pendingSubscriptionId: sub.id }, data: { pendingSubscriptionId: null } })
    // An upgrade (or switch) replaces the old subscription: stop it now so nobody pays for both.
    const { replaces } = notesOf(sub)
    if (replaces && replaces !== sub.id) {
      await razorpay('POST', `/subscriptions/${replaces}/cancel`, { cancel_at_cycle_end: 0 }).catch((err) => {
        // Already cancelled (e.g. a repeated webhook): nothing to do.
        if (!String(err).includes('(400)')) throw err
      })
    }
  } else if (ENDED.has(sub.status)) {
    await db.user.updateMany({ where: { ...where, razorpaySubscriptionId: sub.id }, data: { isPaid: false } })
  }
}

/** Mounted with express.raw(): the signature is computed over the exact bytes Razorpay sent. */
export const razorpayWebhook: RequestHandler = async (req, res) => {
  if (!billingEnabled) throw new HttpError(503, 'Payments are not set up')
  if (!Buffer.isBuffer(req.body) || !signatureMatches(env.RAZORPAY_WEBHOOK_SECRET!, req.body, req.headers['x-razorpay-signature'])) {
    throw new HttpError(400, 'Invalid signature')
  }
  const event = JSON.parse(req.body.toString('utf8')) as {
    event: string
    payload: { subscription?: { entity: Subscription }; payment?: { entity: RazorpayPayment }; refund?: { entity: RazorpayRefund } }
  }
  // Razorpay may deliver an event more than once; everything below only sets values or upserts by id.
  const { subscription, payment, refund } = event.payload
  if (event.event.startsWith('subscription.') && subscription) {
    await applySubscription(subscription.entity)
    if (event.event === 'subscription.charged' && payment) await recordPayment(payment.entity, userIdOf(subscription.entity))
  }
  if (event.event === 'refund.processed' && refund) await recordRefund(refund.entity)
  res.json({ ok: true })
}

export const billingRouter = Router()
billingRouter.use(requireAuth)
billingRouter.use((_req, _res, next) => {
  if (!billingEnabled) throw new HttpError(503, 'Payments are not set up')
  next()
})

// Prices shown on the upgrade cards come from Razorpay, so changing a price there needs no code change.
billingRouter.get('/plans', async (_req, res) => {
  const [pro, proHost] = await Promise.all([getPlanPricePaise('pro'), hostPlanEnabled ? getPlanPricePaise('pro_host') : null])
  res.json({ pro, pro_host: proHost })
})

const checkoutBody = z.object({ plan: z.enum(['pro', 'pro_host']).default('pro') })

billingRouter.post('/checkout', async (req, res) => {
  const user = req.user!
  if (user.isGuest) throw new HttpError(403, 'Log in with Spotify to go Pro')
  const { plan } = checkoutBody.parse(req.body ?? {})
  if (plan === 'pro_host' && !hostPlanEnabled) throw new HttpError(400, 'Pro Host is not available')
  const current = isPro(user) ? (user.proPlan ?? 'pro') : null
  if (current === plan && user.razorpaySubscriptionId) throw new HttpError(409, 'You already have this plan')

  const sub = await razorpay<Subscription>('POST', '/subscriptions', {
    plan_id: plan === 'pro_host' ? env.RAZORPAY_HOST_PLAN_ID : env.RAZORPAY_PLAN_ID,
    total_count: 12, // Razorpay needs an end; 12 monthly charges, then the user can subscribe again.
    customer_notify: 1,
    // replaces: the running subscription to stop once this one is active (upgrade from Pro to Pro Host).
    notes: { userId: user.id, ...(user.razorpaySubscriptionId ? { replaces: user.razorpaySubscriptionId } : {}) },
  })
  // Pending until Razorpay reports it active; the running subscription (if any) stays in razorpaySubscriptionId.
  await db.user.update({ where: { id: user.id }, data: { pendingSubscriptionId: sub.id } })
  res.status(201).json({ keyId: env.RAZORPAY_KEY_ID, subscriptionId: sub.id, name: user.displayName, email: user.email })
})

const verifyBody = z.object({
  razorpay_payment_id: z.string(),
  razorpay_subscription_id: z.string(),
  razorpay_signature: z.string(),
})

// Called by the browser right after checkout so Pro shows up at once instead of waiting for the webhook.
// The signature proves the payment happened; the status then comes from Razorpay directly, not the client.
billingRouter.post('/verify', async (req, res) => {
  const body = verifyBody.parse(req.body)
  const user = req.user!
  if (body.razorpay_subscription_id !== user.pendingSubscriptionId && body.razorpay_subscription_id !== user.razorpaySubscriptionId) {
    throw new HttpError(400, 'Unknown subscription')
  }
  const signed = `${body.razorpay_payment_id}|${body.razorpay_subscription_id}`
  if (!signatureMatches(env.RAZORPAY_KEY_SECRET!, signed, body.razorpay_signature)) throw new HttpError(400, 'Invalid signature')

  const [sub, payment] = await Promise.all([
    razorpay<Subscription>('GET', `/subscriptions/${body.razorpay_subscription_id}`),
    razorpay<RazorpayPayment>('GET', `/payments/${body.razorpay_payment_id}`),
  ])
  await applySubscription(sub)
  await recordPayment(payment, user.id)
  const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } })
  res.json({ active: updated.isPaid, paidUntil: updated.paidUntil })
})

const ABANDONED_AFTER_S = 60 * 60

/**
 * Asks Razorpay about the pending checkout and applies the answer. A backup for the webhook, which can
 * arrive late, fail, or (on a laptop without a tunnel) never arrive: Razorpay sometimes activates a
 * subscription a minute or two after the payment.
 */
billingRouter.post('/sync', async (req, res) => {
  const user = req.user!
  const pendingId = user.pendingSubscriptionId
  if (pendingId) {
    const sub = await razorpay<Subscription>('GET', `/subscriptions/${pendingId}`)
    if (sub.status === 'active') {
      await applySubscription(sub)
      // Store the payment too (the webhook would normally bring it): the subscription's paid invoices.
      const invoices = await razorpay<{ items: { payment_id: string | null; status: string }[] }>('GET', `/invoices?subscription_id=${sub.id}`)
      for (const invoice of invoices.items.filter((i) => i.status === 'paid' && i.payment_id)) {
        await recordPayment(await razorpay<RazorpayPayment>('GET', `/payments/${invoice.payment_id}`), user.id)
      }
    } else if (ENDED.has(sub.status) || (sub.created_at && Date.now() / 1000 - sub.created_at > ABANDONED_AFTER_S)) {
      // Checkout abandoned or failed: stop checking.
      await db.user.update({ where: { id: user.id }, data: { pendingSubscriptionId: null } })
    }
  }
  const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } })
  res.json({ pending: Boolean(updated.pendingSubscriptionId), active: isPro(updated), proPlan: updated.proPlan })
})

billingRouter.post('/cancel', async (req, res) => {
  const user = req.user!
  if (!user.razorpaySubscriptionId) throw new HttpError(404, 'No subscription to cancel')
  // cancel_at_cycle_end: Pro stays until the period they paid for ends; the webhook then turns it off.
  await razorpay('POST', `/subscriptions/${user.razorpaySubscriptionId}/cancel`, { cancel_at_cycle_end: 1 })
  // Nothing left to cancel: forgetting the id hides the button and blocks a second cancel. Pro still ends
  // on its own at paidUntil (isPro checks the date), whether or not the final webhook arrives.
  await db.user.update({ where: { id: user.id }, data: { razorpaySubscriptionId: null } })
  res.status(204).end()
})
