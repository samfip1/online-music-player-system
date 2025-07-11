import { z } from 'zod'

// Product rules. Constants, not env: they're not deployment settings.
// Vote limit and queue size are per-space settings now (phase 18); these are the defaults and allowed ranges.
export const VOTE_LIMIT = 5
export const VOTE_LIMIT_RANGE = { min: 1, max: 20 }
export const MAX_QUEUE = 20
export const MAX_QUEUE_RANGE = { min: 5, max: 50 }
export const COOLDOWN_FREE_MS = 300_000
export const COOLDOWN_PAID_MS = 240_000
// A downvote on a song added by a Pro user counts this much instead of 1 (phase 16).
export const PRO_DOWNVOTE_WEIGHT = 0.4
// Days in the admin dashboard's charts are counted in this timezone.
export const REPORT_TIMEZONE = 'Asia/Kolkata'

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.url(),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  // 32 bytes as 64 hex chars, for AES-256-GCM encryption of Spotify refresh tokens.
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters'),
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_CLIENT_SECRET: z.string().min(1),
  SPOTIFY_REDIRECT_URI: z.url(),
  // Razorpay is optional (phase 9); billing routes stay off until these are set.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_PLAN_ID: z.string().optional(),
  // Pro Host plan: Pro + host insights (phase 22). Optional; without it only Pro is offered.
  RAZORPAY_HOST_PLAN_ID: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // Comma-separated Spotify user ids allowed into /admin (phase 19). Empty = no admins.
  ADMIN_SPOTIFY_IDS: z
    .string()
    .optional()
    .transform((v) => new Set((v ?? '').split(',').map((id) => id.trim()).filter(Boolean))),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:\n' + z.prettifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data

/** Payments are switched on only when every Razorpay setting is present. */
export const billingEnabled = Boolean(
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_PLAN_ID && env.RAZORPAY_WEBHOOK_SECRET,
)
export const hostPlanEnabled = billingEnabled && Boolean(env.RAZORPAY_HOST_PLAN_ID)
