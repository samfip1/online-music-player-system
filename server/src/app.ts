import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { z } from 'zod'
import { adminRouter } from './admin.js'
import { authRouter, requireAuth } from './auth.js'
import { billingRouter, razorpayWebhook } from './billing.js'
import { env } from './config.js'
import { errorHandler } from './errors.js'
import { insightsRouter } from './insights.js'
import { playerRouter } from './player.js'
import { spacesRouter } from './spaces.js'
import { searchTracks } from './spotify.js'

// Built separately from index.ts so tests (Supertest) can use the app without opening a port.
export const app = express()

app.use(cors({ origin: env.CLIENT_URL, credentials: true }))
// Before express.json(): the webhook signature must be checked against the raw bytes.
app.post('/api/billing/webhook', express.raw({ type: '*/*' }), razorpayWebhook)
app.use(express.json())
app.use(cookieParser())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/auth', authRouter)

const searchQuery = z.object({ q: z.string().trim().min(1).max(100) })

app.get('/api/search', requireAuth, async (req, res) => {
  const { q } = searchQuery.parse(req.query)
  res.json(await searchTracks(q))
})

app.use('/api/spaces', spacesRouter)
app.use('/api/spotify', playerRouter)
app.use('/api/billing', billingRouter)
app.use('/api/admin', adminRouter)
app.use('/api/host', insightsRouter)

app.use(errorHandler)
