import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useSearchParams } from 'react-router'
import { UpgradeButton, usePlanPrices } from '../components/billing'
import { LineChart, UpDownChart } from '../components/charts'
import { TopBar } from '../components/TopBar'
import { AlbumArt, Avatar, Backdrop, buttonClass, Card, Equalizer, Icon, PageLoader, ProBadge, type IconName } from '../components/ui'
import { api, type InsightSong, type Insights as InsightsData, type Me } from '../lib/api'
import { artists, compact, rupees, timeAgo } from '../lib/format'
import { useMe } from '../lib/hooks'

// Host insights (phase 22). Free: songs played and peak crowd per party. Pro Host: everything else.
// The server decides what's unlocked; this page only shows what it gets.

export default function Insights() {
  const me = useMe()
  if (me.isPending) return <PageLoader />
  if (!me.data || me.data.isGuest) return <Navigate to="/" replace />
  return <InsightsView me={me.data} />
}

function InsightsView({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams()
  const spaceId = params.get('space') ?? undefined
  const insights = useQuery({
    queryKey: ['insights', spaceId ?? 'all'],
    queryFn: () => api<InsightsData>(`/host/insights${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ''}`),
  })
  const data = insights.data
  const d = data?.details

  return (
    <>
      <Backdrop />
      <TopBar me={me} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-fuchsia-300">
              Host insights {me.isProHost ? <ProBadge /> : null}
            </p>
            <h1 className="font-display text-4xl font-extrabold tracking-tight">How your parties went</h1>
          </div>
          {data?.spaces.length ? (
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              Party
              <select
                value={spaceId ?? ''}
                onChange={(e) => setParams(e.target.value ? { space: e.target.value } : {})}
                className="h-10 rounded-full bg-white/[0.07] px-4 text-zinc-100 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-fuchsia-400/60"
              >
                <option value="">All parties</option>
                {data.spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {insights.isPending ? (
          <div className="grid h-60 place-items-center text-fuchsia-300">
            <Equalizer className="h-8" bars={5} />
          </div>
        ) : !data ? (
          <Card className="p-6 text-sm text-rose-300">Couldn't load insights. Try again in a moment.</Card>
        ) : data.spaces.length === 0 ? (
          <Card className="grid place-items-center px-6 py-16 text-center">
            <Icon name="chart" className="size-8 text-fuchsia-300" />
            <h2 className="mt-4 font-display text-xl font-bold">No parties yet</h2>
            <p className="mt-1 text-sm text-zinc-400">Host a space and your numbers show up here.</p>
            <Link to="/home" className={`${buttonClass('primary', 'md')} mt-5`}>
              Start a space
            </Link>
          </Card>
        ) : (
          <>
            <FreeTable data={data} selected={spaceId} />
            {d ? <Details details={d} single={Boolean(spaceId)} /> : <Locked me={me} />}
          </>
        )}
      </main>
    </>
  )
}

function FreeTable({ data, selected }: { data: InsightsData; selected?: string }) {
  const rows = selected ? data.spaces.filter((s) => s.id === selected) : data.spaces
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="font-display text-lg font-bold">Your parties</h2>
        <span className="text-xs text-zinc-500">free for every host</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr className="border-b border-line">
              <th className="px-5 py-2 font-medium">Party</th>
              <th className="px-3 py-2 font-medium">Started</th>
              <th className="px-3 py-2 text-right font-medium">Songs played</th>
              <th className="px-5 py-2 text-right font-medium">Peak crowd</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3 font-semibold">
                  <Link to={`/space/${s.id}/host`} className="hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="px-3 py-3 text-zinc-400">{timeAgo(s.createdAt)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{s.songsPlayed}</td>
                <td className="px-5 py-3 text-right tabular-nums">{s.peakPeople}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Locked({ me }: { me: Me }) {
  const prices = usePlanPrices(me.billingEnabled)
  return (
    <div className="relative overflow-hidden rounded-3xl">
      {/* Blurred preview of what Pro Host unlocks (sample shapes, not real data), behind the card */}
      <div className="pointer-events-none absolute inset-0 grid gap-4 blur-sm select-none sm:grid-cols-3" aria-hidden>
        {['Top songs', 'Top requesters', 'Crowd over time'].map((t) => (
          <Card key={t} className="h-full p-5">
            <p className="font-semibold">{t}</p>
            <div className="mt-4 space-y-3">
              {[80, 60, 45, 30].map((w) => (
                <div key={w} className="h-3 rounded-full bg-gradient-to-r from-violet-500/50 to-fuchsia-500/30" style={{ width: `${w}%` }} />
              ))}
            </div>
          </Card>
        ))}
      </div>
      {/* In normal flow, so the box always grows to fit the card */}
      <div className="relative grid place-items-center bg-ink/60 px-4 py-10 backdrop-blur-[2px]">
        <Card className="max-w-md p-6 text-center shadow-2xl shadow-black/60">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand text-white">
            <Icon name="chart" className="size-6" />
          </span>
          <h2 className="mt-4 font-display text-xl font-bold">Unlock the full picture</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Top and most-downvoted songs, skips, reactions, your top requesters, and crowd and votes over time, for every party you host.
          </p>
          {me.hostPlanEnabled ? (
            <>
              <UpgradeButton plan="pro_host" size="lg" className="mt-5 w-full" label={`Get Pro Host${prices.data?.pro_host ? ` · ${rupees(prices.data.pro_host)}/mo` : ''}`} />
              <p className="mt-2 text-xs text-zinc-500">
                Includes everything in Pro.{me.isPro ? ' Your current Pro plan is replaced, so you only pay for one.' : ''}
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">Pro Host isn't available yet.</p>
          )}
        </Card>
      </div>
    </div>
  )
}

function Details({ details: d, single }: { details: NonNullable<InsightsData['details']>; single: boolean }) {
  const t = d.totals
  return (
    <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Totals">
        <Tile icon="users" label="People who joined in" value={t.participants} />
        <Tile icon="music" label="Songs played" value={t.songsPlayed} detail={`${t.songsAdded} added`} />
        <Tile icon="up" label="Upvotes" value={t.upvotes} />
        <Tile icon="down" label="Downvotes" value={t.downvotes} />
        <Tile icon="sparkle" label="Reactions" value={t.reactions} />
        <Tile icon="skip" label="Skips" value={t.skippedByHost + t.skippedByRoom} detail={`${t.skippedByRoom} by the room`} />
      </section>

      {single ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <LineChart title="Crowd over time" subtitle="People in the space, sampled every minute" points={(d.crowd ?? []).map((c) => ({ at: c.at, value: c.people }))} />
          <UpDownChart title="Votes over time" subtitle="Per 10 minutes" buckets={d.voteTimeline ?? []} />
        </section>
      ) : (
        <p className="text-sm text-zinc-500">Pick one party above to see its crowd and votes over time.</p>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <SongList title="Crowd favourites" empty="No upvoted songs yet" songs={d.topSongs} stat={(s) => `${s.score > 0 ? '+' : ''}${s.score}`} />
        <Requesters requesters={d.topRequesters} />
        <SongList title="Most downvoted" empty="Nothing got downvoted" songs={d.mostDownvoted} stat={(s) => `▼ ${s.downvotes}`} />
        <SongList title="Most reactions" empty="No reactions yet" songs={d.mostReactions} stat={(s) => `${s.reactions} 🔥`} />
        <SongList
          title="Skipped"
          empty="No songs skipped"
          songs={d.skipped}
          stat={(s) => (s.skipReason === 'room' ? 'room voted' : 'you skipped')}
        />
      </section>
    </>
  )
}

function Tile({ icon, label, value, detail }: { icon: IconName; label: string; value: number; detail?: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-zinc-400">
        <Icon name={icon} className="size-3.5" /> {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{compact(value)}</p>
      {detail ? <p className="text-xs text-zinc-500">{detail}</p> : null}
    </Card>
  )
}

function SongList({ title, empty, songs, stat }: { title: string; empty: string; songs: InsightSong[]; stat: (s: InsightSong) => string }) {
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {songs.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ol className="mt-3 space-y-1">
          {songs.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl p-1.5">
              <span className="w-4 text-center text-xs font-bold text-zinc-500 tabular-nums">{i + 1}</span>
              <AlbumArt url={s.albumArtUrl} className="size-10" rounded="rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{s.title}</p>
                <p className="truncate text-xs text-zinc-500">
                  {artists(s.artists)} · added by {s.addedBy.displayName}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-semibold tabular-nums">{stat(s)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function Requesters({ requesters }: { requesters: NonNullable<InsightsData['details']>['topRequesters'] }) {
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-bold">Top requesters</h2>
      <p className="text-xs text-zinc-500">Whose songs the room liked most. Nobody's individual votes are shown.</p>
      {requesters.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Nobody has added songs yet</p>
      ) : (
        <ol className="mt-3 space-y-1">
          {requesters.map((r, i) => (
            <li key={r.user.id} className="flex items-center gap-3 rounded-xl p-1.5">
              <span className="w-4 text-center text-xs font-bold text-zinc-500 tabular-nums">{i + 1}</span>
              <Avatar name={r.user.displayName} url={r.user.avatarUrl} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="truncate">{r.user.displayName}</span> {r.user.isPro ? <ProBadge /> : null}
                </p>
                <p className="text-xs text-zinc-500">
                  {r.songs} {r.songs === 1 ? 'song' : 'songs'} added
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-semibold tabular-nums">▲ {r.upvotes}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
