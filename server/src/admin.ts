import { Router } from 'express'
import { isAdmin, publicUser, publicUserSelect, requireAuth } from './auth.js'
import { getPlanPricePaise } from './billing.js'
import { REPORT_TIMEZONE } from './config.js'
import { db } from './db.js'
import { HttpError } from './errors.js'
import { Prisma } from './generated/prisma/client.js'
import { livePresence } from './realtime.js'

// Admin dashboard API (phase 19). Anyone who isn't an admin gets a plain 404, so the
// page's existence isn't revealed.

export const adminRouter = Router()
adminRouter.use(requireAuth)
adminRouter.use((req, _res, next) => {
  if (!isAdmin(req.user!)) throw new HttpError(404, 'Not found')
  next()
})

// ---- Live now (from socket presence) ----

adminRouter.get('/live', async (_req, res) => {
  const live = livePresence()
  const spaces = await db.space.findMany({
    where: { id: { in: live.map((l) => l.spaceId) } },
    include: {
      host: { select: publicUserSelect },
      currentItem: { select: { title: true, artists: true, albumArtUrl: true } },
      _count: { select: { queueItems: { where: { played: false } } } },
    },
  })
  const people = new Map(live.map((l) => [l.spaceId, l.users]))

  const rows = spaces
    .map((s) => {
      const users = people.get(s.id) ?? []
      return {
        id: s.id,
        name: s.name,
        host: publicUser(s.host),
        hostOnline: users.some((u) => u.id === s.hostId),
        people: users.length,
        nowPlaying: s.currentItem,
        queueLength: s._count.queueItems,
      }
    })
    .sort((a, b) => b.people - a.people)

  const everyone = new Map(live.flatMap((l) => l.users.map((u) => [u.id, u])))
  res.json({
    spaces: rows,
    people: everyone.size,
    guests: [...everyone.values()].filter((u) => u.isGuest).length,
    hostsOnline: rows.filter((r) => r.hostOnline).length,
  })
})

// ---- Totals, revenue and daily charts ----

// Dates are compared as local calendar days in REPORT_TIMEZONE. Columns are UTC timestamps.
const tz = REPORT_TIMEZONE
const localDay = (column: string) => Prisma.sql`((${Prisma.raw(`"${column}"`)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`
const today = Prisma.sql`(now() AT TIME ZONE ${tz})::date`

type Periods = { today: number; week: number; all: number }

/** Counts rows for today, the last 7 days and all time. Table/column names are fixed strings, never user input. */
async function periods(table: string, column: string, where: Prisma.Sql = Prisma.sql`TRUE`): Promise<Periods> {
  const [row] = await db.$queryRaw<Periods[]>`
    SELECT
      count(*) FILTER (WHERE ${localDay(column)} = ${today})::int AS "today",
      count(*) FILTER (WHERE ${localDay(column)} > ${today} - 7)::int AS "week",
      count(*)::int AS "all"
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE ${where}`
  return row
}

adminRouter.get('/stats', async (_req, res) => {
  const [hosts, guests, spaces, plays, upvotes, downvotes] = await Promise.all([
    periods('User', 'createdAt', Prisma.sql`NOT "isGuest"`),
    periods('User', 'createdAt', Prisma.sql`"isGuest"`),
    periods('Space', 'createdAt'),
    periods('QueueItem', 'playedAt', Prisma.sql`"played"`),
    periods('Vote', 'createdAt', Prisma.sql`"value" > 0`),
    periods('Vote', 'createdAt', Prisma.sql`"value" < 0`),
  ])

  const active = { isPaid: true, paidUntil: { gt: new Date() } }
  const [[money], activePro, activeProHost, pricePaise, hostPricePaise, recent, daily] = await Promise.all([
    db.$queryRaw<{ allTime: number; thisMonth: number }[]>`
      SELECT
        COALESCE(SUM(amount), 0)::int AS "allTime",
        COALESCE(SUM(amount) FILTER (WHERE day >= date_trunc('month', ${today})::date), 0)::int AS "thisMonth"
      FROM (
        SELECT amount, ${localDay('createdAt')} AS day FROM "Payment"
        UNION ALL
        SELECT -amount, ${localDay('createdAt')} AS day FROM "Refund"
      ) AS money`,
    // Members from before tiers existed have no proPlan: they're on Pro. (SQL NOT would skip those NULLs.)
    db.user.count({ where: { ...active, OR: [{ proPlan: null }, { proPlan: 'pro' }] } }),
    db.user.count({ where: { ...active, proPlan: 'pro_host' } }),
    getPlanPricePaise('pro'),
    getPlanPricePaise('pro_host'),
    db.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { user: { select: { displayName: true, email: true } }, refunds: { select: { amount: true } } },
    }),
    // One row per day for the last 30 days, including days with nothing.
    db.$queryRaw<{ day: Date; users: number; plays: number; revenue: number }[]>`
      SELECT
        d.day,
        (SELECT count(*) FROM "User" WHERE ${localDay('createdAt')} = d.day)::int AS "users",
        (SELECT count(*) FROM "QueueItem" WHERE "played" AND ${localDay('playedAt')} = d.day)::int AS "plays",
        (
          COALESCE((SELECT SUM(amount) FROM "Payment" WHERE ${localDay('createdAt')} = d.day), 0)
          - COALESCE((SELECT SUM(amount) FROM "Refund" WHERE ${localDay('createdAt')} = d.day), 0)
        )::int AS "revenue"
      FROM generate_series(${today} - 29, ${today}, interval '1 day') AS d(day)
      ORDER BY d.day`,
  ])

  res.json({
    totals: { hosts, guests, spaces, plays, upvotes, downvotes },
    revenue: {
      currency: 'INR',
      activePro,
      activeProHost,
      pricePaise,
      hostPricePaise,
      // Unknown if a price can't be read and someone is on that plan.
      mrrPaise:
        (activePro && pricePaise === null) || (activeProHost && hostPricePaise === null) || pricePaise === null
          ? null
          : activePro * pricePaise + activeProHost * (hostPricePaise ?? 0),
      thisMonthPaise: money.thisMonth,
      allTimePaise: money.allTime,
    },
    // Admin-only, so the payer's email is shown here (never in public responses).
    payments: recent.map((p) => ({
      id: p.id,
      amountPaise: p.amount,
      refundedPaise: p.refunds.reduce((sum, r) => sum + r.amount, 0),
      currency: p.currency,
      createdAt: p.createdAt,
      user: p.user,
    })),
    daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), users: d.users, plays: d.plays, revenuePaise: d.revenue })),
    timezone: tz,
  })
})
