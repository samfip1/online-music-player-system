import { randomBytes } from 'node:crypto'
import { Router, type CookieOptions, type RequestHandler, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { billingEnabled, env, hostPlanEnabled } from './config.js'
import { encrypt } from './crypto.js'
import { db } from './db.js'
import { HttpError } from './errors.js'
import type { User } from './generated/prisma/client.js'
import { authorizeUrl, exchangeCode, getProfile, SpotifyError } from './spotify.js'

declare global {
  namespace Express {
    interface Request {
      user?: User
    }
  }
}

const SESSION_COOKIE = 'sid'
const STATE_COOKIE = 'spotify_state'
const RETURN_COOKIE = 'spotify_return'
const SESSION_DAYS = 30

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.CLIENT_URL.startsWith('https://'),
  path: '/',
}

export function signSession(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn: `${SESSION_DAYS}d`, algorithm: 'HS256' })
}

function setSession(res: Response, userId: string) {
  res.cookie(SESSION_COOKIE, signSession(userId), { ...cookieOptions, maxAge: SESSION_DAYS * 86_400_000 })
}

export function isPro(user: Pick<User, 'isPaid' | 'paidUntil'>): boolean {
  return user.isPaid && user.paidUntil !== null && user.paidUntil > new Date()
}

/** Pro Host = Pro plus host insights (phase 22). */
export function isProHost(user: Pick<User, 'isPaid' | 'paidUntil' | 'proPlan'>): boolean {
  return isPro(user) && user.proPlan === 'pro_host'
}

/** Admins are listed by Spotify id in ADMIN_SPOTIFY_IDS. Guests never qualify. */
export function isAdmin(user: Pick<User, 'isGuest' | 'spotifyId'>): boolean {
  return !user.isGuest && user.spotifyId !== null && env.ADMIN_SPOTIFY_IDS.has(user.spotifyId)
}

/** Fields safe to send to any client. Never includes email or tokens. */
export const publicUserSelect = { id: true, displayName: true, avatarUrl: true, isGuest: true, isPaid: true, paidUntil: true } as const

export function publicUser(u: Pick<User, 'id' | 'displayName' | 'avatarUrl' | 'isGuest' | 'isPaid' | 'paidUntil'>) {
  return { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, isGuest: u.isGuest, isPro: isPro(u) }
}

/** Returns the user id from a session token, or null if it's missing, forged or expired. */
export function verifySession(token: string | undefined): string | null {
  try {
    const { sub } = jwt.verify(token ?? '', env.JWT_SECRET, { algorithms: ['HS256'] })
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

/** Reads the session cookie from a raw Cookie header (for Socket.IO, which has no cookie-parser). */
export function sessionFromCookieHeader(header: string | undefined): string | null {
  const raw = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(header ?? '')?.[1]
  return verifySession(raw && decodeURIComponent(raw))
}

/** Loads the session user from the cookie into req.user. The user id always comes from here, never from the client. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const userId = verifySession(req.cookies?.[SESSION_COOKIE])
  const user = userId ? await db.user.findUnique({ where: { id: userId } }) : null
  if (!user) throw new HttpError(401, 'Not logged in')
  req.user = user
  next()
}

export const authRouter = Router()

// Only same-site paths like "/space/abc", never "//evil.com" or a full URL (no open redirect).
const returnPath = z.string().regex(/^\/(?!\/)[\w\-/]*$/).max(200)

authRouter.get('/spotify/login', (req, res) => {
  // CSRF protection: the callback only accepts the state value we set in this cookie.
  const state = randomBytes(16).toString('hex')
  res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 10 * 60_000 })
  const returnTo = returnPath.safeParse(req.query.returnTo)
  if (returnTo.success) res.cookie(RETURN_COOKIE, returnTo.data, { ...cookieOptions, maxAge: 10 * 60_000 })
  res.redirect(authorizeUrl(state))
})

authRouter.get('/spotify/callback', async (req, res) => {
  const { code, state, error } = req.query
  const expectedState = req.cookies?.[STATE_COOKIE]
  const returnTo = returnPath.safeParse(req.cookies?.[RETURN_COOKIE])
  res.clearCookie(STATE_COOKIE, cookieOptions)
  res.clearCookie(RETURN_COOKIE, cookieOptions)

  const fail = (reason: string) => res.redirect(`${env.CLIENT_URL}/?error=${reason}`)
  if (error || typeof code !== 'string' || !expectedState || state !== expectedState) return fail('login_failed')

  let tokens, profile
  try {
    tokens = await exchangeCode(code)
    profile = await getProfile(tokens.access_token)
  } catch (err) {
    console.error(err)
    // Spotify answers 403 when the account isn't on the app's tester list (development mode).
    return fail(err instanceof SpotifyError && err.status === 403 ? 'not_registered' : 'login_failed')
  }

  const fields = {
    email: profile.email ?? null,
    displayName: profile.display_name || profile.id,
    avatarUrl: profile.images?.[0]?.url ?? null,
    spotifyRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
  }
  const user = await db.user.upsert({
    where: { spotifyId: profile.id },
    create: { spotifyId: profile.id, ...fields },
    update: fields,
  })

  setSession(res, user.id)
  res.redirect(env.CLIENT_URL + (returnTo.success ? returnTo.data : '/home'))
})

const guestBody = z.object({ displayName: z.string().trim().min(1).max(30) })

authRouter.post('/guest', async (req, res) => {
  const { displayName } = guestBody.parse(req.body)
  const user = await db.user.create({ data: { displayName, isGuest: true } })
  setSession(res, user.id)
  res.status(201).json(publicUser(user))
})

authRouter.get('/me', requireAuth, (req, res) => {
  const user = req.user!
  res.json({
    ...publicUser(user),
    paidUntil: user.paidUntil,
    hasSubscription: Boolean(user.razorpaySubscriptionId),
    // A checkout Razorpay hasn't activated yet: the client asks /billing/sync until it resolves.
    pendingPayment: Boolean(user.pendingSubscriptionId),
    billingEnabled,
    hostPlanEnabled,
    isProHost: isProHost(user),
    isAdmin: isAdmin(user),
  })
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions)
  res.status(204).end()
})
