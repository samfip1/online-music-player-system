import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { TopBar } from '../components/TopBar'
import { AlbumArt, Avatar, Backdrop, Card, Equalizer, FullScreenMessage, Icon, PageLoader, ProBadge } from '../components/ui'
import { api, type PublicUser } from '../lib/api'
import { compact, rupees, timeAgo } from '../lib/format'
import { BarChart } from '../components/charts'
import { useMe } from '../lib/hooks'

// Admin dashboard (phase 19). The server answers 404 to non-admins; this page mirrors that.

type Periods = { today: number; week: number; all: number }
type Live = {
  people: number
  guests: number
  hostsOnline: number
  spaces: {
    id: string
    name: string
    host: PublicUser
    hostOnline: boolean
    people: number
    queueLength: number
    nowPlaying: { title: string; artists: string[]; albumArtUrl: string | null } | null
  }[]
}
type Stats = {
  totals: Record<'hosts' | 'guests' | 'spaces' | 'plays' | 'upvotes' | 'downvotes', Periods>
  revenue: {
    currency: string
    activePro: number
    activeProHost: number
    pricePaise: number | null
    hostPricePaise: number | null
    mrrPaise: number | null
    thisMonthPaise: number
    allTimePaise: number
  }
  payments: { id: string; amountPaise: number; refundedPaise: number; createdAt: string; user: { displayName: string; email: string | null } | null }[]
  daily: { day: string; users: number; plays: number; revenuePaise: number }[]
  timezone: string
}


export default function Admin() {
  const me = useMe()
  if (me.isPending) return <PageLoader />
  if (!me.data?.isAdmin) {
    return (
      <>
        <Backdrop />
        <FullScreenMessage icon="music" title="Page not found" />
      </>
    )
  }
  return <Dashboard me={me.data} />
}

function Dashboard({ me }: { me: NonNullable<ReturnType<typeof useMe>['data']> }) {
  const queryClient = useQueryClient()
  const live = useQuery({ queryKey: ['admin', 'live'], queryFn: () => api<Live>('/admin/live') })
  // Totals change slowly: a 30s refresh is a deliberate exception to "no polling" for this one admin page.
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<Stats>('/admin/stats'), refetchInterval: 30_000 })
  const [connected, setConnected] = useState(false)

  // Live section: the server nudges the "admin" room (at most every 2s) when anything changes.
  useEffect(() => {
    const socket = io({ withCredentials: true })
    socket.on('connect', () => {
      setConnected(true)
      socket.emit('admin:join')
      void queryClient.invalidateQueries({ queryKey: ['admin', 'live'] })
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('admin:changed', () => void queryClient.invalidateQueries({ queryKey: ['admin', 'live'] }))
    return () => {
      socket.close()
    }
  }, [queryClient])

  const s = stats.data
  const l = live.data

  return (
    <>
      <Backdrop />
      <TopBar me={me}>
        <span className={`flex items-center gap-2 text-xs font-semibold ${connected ? 'text-emerald-300' : 'text-amber-300'}`}>
          <span className={`size-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`} /> {connected ? 'Live' : 'Reconnecting'}
        </span>
      </TopBar>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <div>
          <p className="text-sm font-medium text-fuchsia-300">Admin</p>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Dashboard</h1>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5" aria-label="Key numbers">
          <StatTile label="Listening now" value={l ? compact(l.people) : '–'} detail={l ? `${l.guests} guests` : undefined} live />
          <StatTile label="Live spaces" value={l ? compact(l.spaces.length) : '–'} detail={l ? `${l.hostsOnline} ${l.hostsOnline === 1 ? 'host' : 'hosts'} online` : undefined} live />
          <StatTile
            label="Paying members"
            value={s ? compact(s.revenue.activePro + s.revenue.activeProHost) : '–'}
            detail={s ? `${s.revenue.activePro} Pro · ${s.revenue.activeProHost} Pro Host` : undefined}
          />
          <StatTile
            label="MRR"
            value={s ? rupees(s.revenue.mrrPaise) : '–'}
            detail={s && s.revenue.mrrPaise === null ? 'set up Razorpay to see this' : 'monthly recurring'}
          />
          <StatTile label="Revenue this month" value={s ? rupees(s.revenue.thisMonthPaise) : '–'} detail={s ? `${rupees(s.revenue.allTimePaise)} all time` : undefined} />
        </section>

        <LiveSpaces live={l} />

        {s ? (
          <>
            <section className="grid gap-4 lg:grid-cols-3" aria-label="Last 30 days">
              <BarChart title="New users" days={s.daily} value={(d) => d.users} format={compact} />
              <BarChart title="Songs played" days={s.daily} value={(d) => d.plays} format={compact} />
              <BarChart title="Revenue (net)" days={s.daily} value={(d) => d.revenuePaise} format={rupees} />
            </section>
            <p className="-mt-2 text-xs text-zinc-500">Last 30 days, counted in {s.timezone} time.</p>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <Totals totals={s.totals} />
              <Payments payments={s.payments} />
            </div>
          </>
        ) : (
          <div className="grid h-60 place-items-center text-fuchsia-300">
            <Equalizer className="h-8" bars={5} />
          </div>
        )}
      </main>
    </>
  )
}

function StatTile({ label, value, detail, live }: { label: string; value: string; detail?: string; live?: boolean }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="flex items-center gap-1.5 text-sm text-zinc-400">
        {live ? <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden /> : null}
        {label}
      </p>
      <p className="mt-1 truncate font-sans text-2xl font-semibold sm:text-3xl">{value}</p>
      {detail ? <p className="mt-0.5 truncate text-xs text-zinc-500">{detail}</p> : null}
    </Card>
  )
}

function LiveSpaces({ live }: { live: Live | undefined }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="font-display text-lg font-bold">Live spaces</h2>
        <span className="text-xs text-zinc-500">updates as people come and go</span>
      </div>
      {!live ? (
        <div className="h-24 animate-pulse" />
      ) : live.spaces.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-zinc-500">Nobody is in a space right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr className="border-b border-line">
                <th className="px-5 py-2 font-medium">Space</th>
                <th className="px-3 py-2 font-medium">Host</th>
                <th className="px-3 py-2 font-medium">Now playing</th>
                <th className="px-3 py-2 text-right font-medium">People</th>
                <th className="px-5 py-2 text-right font-medium">Queue</th>
              </tr>
            </thead>
            <tbody>
              {live.spaces.map((sp) => (
                <tr key={sp.id} className="border-b border-line last:border-0 hover:bg-white/[0.03]">
                  <td className="px-5 py-3">
                    <a href={`/space/${sp.id}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                      {sp.name}
                    </a>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2">
                      <Avatar name={sp.host.displayName} url={sp.host.avatarUrl} className="size-6 text-[10px]" />
                      <span className="truncate">{sp.host.displayName}</span>
                      {sp.host.isPro ? <ProBadge /> : null}
                      <span
                        className={`text-xs ${sp.hostOnline ? 'text-emerald-300' : 'text-zinc-500'}`}
                        title={sp.hostOnline ? 'Host is connected' : 'Host is not connected'}
                      >
                        {sp.hostOnline ? '● online' : '○ away'}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {sp.nowPlaying ? (
                      <span className="flex items-center gap-2">
                        <AlbumArt url={sp.nowPlaying.albumArtUrl} className="size-7" rounded="rounded" />
                        <span className="max-w-56 truncate">
                          {sp.nowPlaying.title} <span className="text-zinc-500">· {sp.nowPlaying.artists.join(', ')}</span>
                        </span>
                      </span>
                    ) : (
                      <span className="text-zinc-500">Nothing</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{sp.people}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{sp.queueLength}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

const totalRows: [keyof Stats['totals'], string][] = [
  ['hosts', 'Hosts (Spotify)'],
  ['guests', 'Guests'],
  ['spaces', 'Spaces created'],
  ['plays', 'Songs played'],
  ['upvotes', 'Upvotes'],
  ['downvotes', 'Downvotes'],
]

function Totals({ totals }: { totals: Stats['totals'] }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 font-display text-lg font-bold">Totals</h2>
      <table className="w-full text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1.5 text-left font-medium" />
            <th className="py-1.5 text-right font-medium">Today</th>
            <th className="py-1.5 text-right font-medium">7 days</th>
            <th className="py-1.5 text-right font-medium">All time</th>
          </tr>
        </thead>
        <tbody>
          {totalRows.map(([key, label]) => (
            <tr key={key} className="border-t border-line">
              <td className="py-2 text-zinc-300">{label}</td>
              <td className="py-2 text-right tabular-nums">{compact(totals[key].today)}</td>
              <td className="py-2 text-right tabular-nums">{compact(totals[key].week)}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{compact(totals[key].all)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function Payments({ payments }: { payments: Stats['payments'] }) {
  return (
    <Card className="overflow-hidden">
      <h2 className="px-5 pt-5 pb-3 font-display text-lg font-bold">Recent payments</h2>
      {payments.length === 0 ? (
        <p className="flex items-center gap-2 px-5 pb-6 text-sm text-zinc-500">
          <Icon name="crown" className="size-4" /> No payments yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-5 py-2.5">
                    <p className="font-medium">{p.user?.displayName ?? 'Unknown user'}</p>
                    {p.user?.email ? <p className="text-xs text-zinc-500">{p.user.email}</p> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {rupees(p.amountPaise)}
                    {p.refundedPaise ? <p className="text-xs text-rose-300">−{rupees(p.refundedPaise)} refunded</p> : null}
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs text-zinc-500" title={new Date(p.createdAt).toLocaleString()}>
                    {timeAgo(p.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
