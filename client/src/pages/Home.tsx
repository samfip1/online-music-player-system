import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { CancelProButton, UpgradeButton, usePlanPrices } from '../components/billing'
import { useToast } from '../components/toast'
import { TopBar } from '../components/TopBar'
import { Backdrop, Button, buttonClass, Card, Equalizer, FullScreenMessage, Icon, IconButton, PageLoader, ProBadge } from '../components/ui'
import { api, spotifyLoginUrl, type Me, type Space } from '../lib/api'
import { rupees, timeAgo } from '../lib/format'
import { useMe } from '../lib/hooks'
import { shareSpace } from '../lib/share'

export function Home() {
  const me = useMe()
  if (me.isPending) return <PageLoader />
  if (!me.data) return <Navigate to="/" replace />
  if (me.data.isGuest) {
    return (
      <>
        <Backdrop />
        <FullScreenMessage icon="host" title="Hosting needs Spotify">
          <p>Guests can join and vote in any space. To host your own, log in with a Spotify Premium account.</p>
          <a href={spotifyLoginUrl('/home')} className={`${buttonClass('primary', 'lg')} mt-6`}>
            Log in with Spotify
          </a>
        </FullScreenMessage>
      </>
    )
  }
  return <HomeContent me={me.data} />
}

function HomeContent({ me }: { me: Me }) {
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces') })
  const firstName = me.displayName.split(' ')[0]

  return (
    <>
      <Backdrop />
      <TopBar me={me} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="animate-rise">
          <p className="text-sm font-medium text-fuchsia-300">Hey {firstName} 👋</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Your spaces</h1>
            <Link to="/insights" className={buttonClass('secondary', 'sm')}>
              <Icon name="chart" className="size-4" /> Insights
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_22rem]">
          <CreateSpace />
          <ProCard me={me} />
        </div>

        <div className="mt-10">
          {spaces.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="glass h-40 animate-pulse rounded-3xl" />
              ))}
            </div>
          ) : spaces.data?.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {spaces.data.map((space, i) => (
                <SpaceCard key={space.id} space={space} index={i} />
              ))}
            </ul>
          ) : (
            <Card className="grid place-items-center px-6 py-16 text-center">
              <Equalizer className="h-10 text-fuchsia-400/70" bars={5} playing={false} />
              <h2 className="mt-5 font-display text-xl font-bold">No spaces yet</h2>
              <p className="mt-1 max-w-sm text-sm text-zinc-400">Create one above, open it, and share the link with your friends.</p>
            </Card>
          )}
        </div>
      </main>
    </>
  )
}

function CreateSpace() {
  const [name, setName] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()

  const create = useMutation({
    mutationFn: () => api<Space>('/spaces', { method: 'POST', body: { name } }),
    onSuccess: (space) => {
      void queryClient.invalidateQueries({ queryKey: ['spaces'] })
      navigate(`/space/${space.id}/host`)
    },
    onError: (err) => toast(err.message, 'error'),
  })

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Start a new space</h2>
      <p className="mt-1 text-sm text-zinc-400">Give it a name people will recognise when they open the link.</p>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Friday night, Road trip, Office radio…"
          aria-label="Space name"
          className="h-12 flex-1 rounded-full bg-black/30 px-5 text-base ring-1 ring-white/10 transition outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-fuchsia-400/60"
        />
        <Button size="lg" type="submit" loading={create.isPending} disabled={!name.trim()}>
          <Icon name="plus" className="size-5" /> Create
        </Button>
      </form>
    </Card>
  )
}

function ProCard({ me }: { me: Me }) {
  const prices = usePlanPrices(me.billingEnabled)
  const price = (plan: 'pro' | 'pro_host') => (prices.data?.[plan] ? ` · ${rupees(prices.data[plan])}/mo` : '')
  const until = me.paidUntil ? new Date(me.paidUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null

  if (me.isPro) {
    return (
      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div className="absolute -top-10 -right-10 size-32 rounded-full bg-amber-400/20 blur-2xl" />
        <div className="flex items-center gap-2">
          <ProBadge /> <span className="font-display font-bold">{me.isProHost ? "You're Pro Host" : "You're Pro"}</span>
        </div>
        <p className="mt-2 text-sm text-zinc-400">
          {me.isProHost ? 'Every Pro perk plus full host insights' : '4-minute vote cooldowns, downvote protection and a Pro badge'}
          {until ? ` until ${until}` : ''}.
        </p>
        {me.hasSubscription ? (
          <div className="mt-2 -ml-3">
            <CancelProButton />
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">Renewal cancelled. You won't be charged again.</p>
        )}
        {!me.isProHost && me.hostPlanEnabled ? (
          <UpgradeButton plan="pro_host" size="sm" className="mt-3" label={`Upgrade to Pro Host${price('pro_host')}`} />
        ) : null}
      </Card>
    )
  }
  if (!me.billingEnabled) return null
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div className="absolute -top-10 -right-10 size-32 rounded-full bg-fuchsia-500/25 blur-2xl" />
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        Go <ProBadge className="text-xs" />
      </h2>
      <ul className="mt-2 space-y-1 text-sm text-zinc-400">
        <li>• Vote again after 4 minutes instead of 5</li>
        <li>• Downvotes on your songs count less (0.4×)</li>
        <li>• A Pro badge next to your name</li>
      </ul>
      <UpgradeButton className="mt-4 w-full" label={`Go Pro${price('pro')}`} />
      {me.hostPlanEnabled ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-sm text-zinc-300">
            <span className="font-semibold">Pro Host</span> <span className="text-zinc-500">· everything in Pro, plus insights for your parties</span>
          </p>
          <UpgradeButton plan="pro_host" size="sm" className="mt-3 w-full" label={`Go Pro Host${price('pro_host')}`} />
        </div>
      ) : null}
    </Card>
  )
}

function SpaceCard({ space, index }: { space: Space; index: number }) {
  const [confirming, setConfirming] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const remove = useMutation({
    mutationFn: () => api(`/spaces/${space.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['spaces'] })
      toast(`Deleted “${space.name}”`, 'success')
    },
    onError: (err) => toast(err.message, 'error'),
  })

  return (
    <li className="group glass flex animate-rise flex-col rounded-3xl p-5 transition hover:bg-white/[0.06]" style={{ animationDelay: `${index * 50}ms` }}>
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-fuchsia-600/20">
          <Equalizer className="h-5" bars={3} playing={Boolean(space.currentItemId)} />
        </span>
        <div className="flex items-center">
          <Link to={`/insights?space=${space.id}`} aria-label="Insights for this space" title="Insights" className="grid size-9 place-items-center rounded-full text-zinc-400 transition hover:bg-white/[0.08] hover:text-white">
            <Icon name="chart" className="size-[18px]" />
          </Link>
          <IconButton icon="link" label="Copy invite link" onClick={() => void shareSpace(space, toast)} />
          {confirming ? (
            <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => remove.mutate()} onBlur={() => setConfirming(false)} autoFocus>
              Delete?
            </Button>
          ) : (
            <IconButton icon="trash" label="Delete space" onClick={() => setConfirming(true)} className="hover:text-rose-300" />
          )}
        </div>
      </div>
      <h3 className="mt-4 truncate font-display text-xl font-bold">{space.name}</h3>
      <p className="text-sm text-zinc-500">Created {timeAgo(space.createdAt)}</p>
      <Link to={`/space/${space.id}/host`} className={`${buttonClass('secondary', 'md')} mt-5 w-full group-hover:bg-white/[0.12]`}>
        Open host view <Icon name="arrowRight" className="size-4" />
      </Link>
    </li>
  )
}
