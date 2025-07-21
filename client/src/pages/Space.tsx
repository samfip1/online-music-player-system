import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router'
import { History } from '../components/space/History'
import { HostPlayer } from '../components/space/HostPlayer'
import { InviteButton } from '../components/space/Invite'
import { People } from '../components/space/People'
import { FloatingReactions, ReactionBar, useFloatingReactions } from '../components/space/Reactions'
import { SettingsButton } from '../components/space/Settings'
import { SkipVote } from '../components/space/SkipVote'
import { NowPlaying, type TimedPlayerState } from '../components/space/NowPlaying'
import { Queue, QueueSkeleton } from '../components/space/Queue'
import { effectiveQuota, QuotaCard } from '../components/space/QuotaCard'
import { Search } from '../components/space/Search'
import { useToast } from '../components/toast'
import { TopBar } from '../components/TopBar'
import { Backdrop, Button, buttonClass, FullScreenMessage, Icon, LogoMark, PageLoader } from '../components/ui'
import { api, ApiError, isStatus, spotifyLoginUrl, type Me, type QueueState, type SpaceDetail } from '../lib/api'
import { useMe, useNow, useSpaceSocket } from '../lib/hooks'

export function SpacePage({ hostMode }: { hostMode: boolean }) {
  const { id = '' } = useParams()
  const me = useMe()
  if (me.isPending) return <PageLoader />
  if (!me.data) return <JoinScreen />
  return <SpaceView key={id} spaceId={id} me={me.data} hostMode={hostMode} />
}

function SpaceView({ spaceId, me, hostMode }: { spaceId: string; me: Me; hostMode: boolean }) {
  const toast = useToast()
  const space = useQuery({ queryKey: ['space', spaceId], queryFn: () => api<SpaceDetail>(`/spaces/${spaceId}`), retry: false })
  const queue = useQuery({ queryKey: ['queue', spaceId], queryFn: () => api<QueueState>(`/spaces/${spaceId}/queue`), retry: false })
  const reactions = useFloatingReactions()
  const { socket, connected, playerState, presence, removed } = useSpaceSocket(spaceId, space.isSuccess, {
    reaction: reactions.add,
    skipped: (title) => toast(`The room skipped “${title}”`, 'info'),
  })
  const [hostPlayerState, setHostPlayerState] = useState<TimedPlayerState | null>(null)

  const isHost = space.data?.hostId === me.id
  const now = useNow(1000, Boolean(queue.data?.quota.lockedUntil))

  if (removed || isBanned(space.error) || isBanned(queue.error)) {
    return (
      <>
        <Backdrop />
        <FullScreenMessage icon="ban" title="You've been removed from this space">
          <p>The host removed you, so you can't add songs or vote here anymore.</p>
          <Link to="/" className={`${buttonClass('secondary', 'md')} mt-6`}>
            Go to SonicVote
          </Link>
        </FullScreenMessage>
      </>
    )
  }
  if (isStatus(space.error, 404) || isStatus(queue.error, 404)) {
    return (
      <>
        <Backdrop />
        <FullScreenMessage icon="music" title="This space has ended">
          <p>The host closed it, or the link is wrong.</p>
          <Link to={me.isGuest ? '/' : '/home'} className={`${buttonClass('secondary', 'md')} mt-6`}>
            {me.isGuest ? 'Go to SonicVote' : 'Back to your spaces'}
          </Link>
        </FullScreenMessage>
      </>
    )
  }
  if (space.isError) {
    return (
      <FullScreenMessage icon="alert" title="Couldn't load this space">
        <Button className="mt-6" onClick={() => void space.refetch()}>
          Try again
        </Button>
      </FullScreenMessage>
    )
  }
  if (!space.data) return <PageLoader />
  if (hostMode && !isHost) return <Navigate to={`/space/${spaceId}`} replace />

  const state = queue.data
  const quota = state ? effectiveQuota(state.quota, now) : null
  const player = hostMode ? hostPlayerState : playerState

  return (
    <>
      <Backdrop imageUrl={state?.nowPlaying?.albumArtUrl} />
      <TopBar me={me}>
        <LiveDot connected={connected} />
        <People spaceId={spaceId} presence={presence} hostId={space.data.hostId} meId={me.id} />
        {isHost && !hostMode ? (
          <Link to={`/space/${spaceId}/host`} className={`${buttonClass('secondary', 'sm')} hidden sm:inline-flex`}>
            <Icon name="host" className="size-4" /> Host view
          </Link>
        ) : null}
        {hostMode ? <SettingsButton space={space.data} /> : null}
        <InviteButton space={space.data} />
      </TopBar>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
        <div className="mb-6 animate-rise sm:mb-8">
          <p className="flex items-center gap-2 text-sm text-zinc-400">
            {hostMode ? (
              <span className="rounded-full bg-fuchsia-400/15 px-2 py-0.5 text-xs font-semibold text-fuchsia-200">You're hosting</span>
            ) : (
              <>Hosted by {space.data.host.displayName}</>
            )}
          </p>
          <h1 className="mt-1.5 truncate font-display text-3xl font-extrabold tracking-tight sm:text-5xl">{space.data.name}</h1>
        </div>

        <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
          <aside className="space-y-4 sm:space-y-5 lg:sticky lg:top-24">
            {state ? (
              <NowPlaying
                item={state.nowPlaying}
                player={player}
                isHost={hostMode}
                overlay={<FloatingReactions items={reactions.items} recent={reactions.recent} />}
              >
                {state.nowPlaying ? (
                  <>
                    <ReactionBar spaceId={spaceId} socket={connected ? socket : null} />
                    {hostMode ? null : <SkipVote spaceId={spaceId} state={state} present={presence?.count ?? null} />}
                  </>
                ) : null}
              </NowPlaying>
            ) : (
              <div className="glass h-40 animate-pulse rounded-3xl" />
            )}
            {hostMode && state ? <HostPlayer spaceId={spaceId} state={state} socket={socket} onState={setHostPlayerState} /> : null}
            {state ? <QuotaCard quota={state.quota} me={me} /> : null}
          </aside>

          <div className="min-w-0 space-y-4 sm:space-y-5">
            {state ? <Search spaceId={spaceId} state={state} isHost={isHost} /> : null}
            {state && quota ? <Queue spaceId={spaceId} state={state} locked={Boolean(quota.lockedUntil)} isHost={isHost} /> : <QueueSkeleton />}
            {state ? <History spaceId={spaceId} state={state} isHost={isHost} /> : null}
          </div>
        </div>
      </main>
    </>
  )
}

const isBanned = (err: unknown) => err instanceof ApiError && err.status === 403 && err.body.code === 'banned'

function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span className={`mr-1 flex items-center gap-2 text-xs font-semibold ${connected ? 'text-emerald-300' : 'text-amber-300'}`} title={connected ? 'Live updates on' : 'Reconnecting…'}>
      <span className="relative flex size-2">
        {connected ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /> : null}
        <span className={`relative inline-flex size-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      </span>
      <span className="hidden sm:inline">{connected ? 'Live' : 'Reconnecting'}</span>
    </span>
  )
}

/** Shown when someone opens a space link without being logged in: pick a nickname and you're in. */
function JoinScreen() {
  const [name, setName] = useState('')
  const queryClient = useQueryClient()
  const location = useLocation()
  const join = useMutation({
    mutationFn: () => api('/auth/guest', { method: 'POST', body: { displayName: name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })

  return (
    <>
      <Backdrop />
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <div className="w-full max-w-md animate-rise">
          <div className="glass rounded-[2rem] p-6 shadow-2xl shadow-black/40 sm:p-8">
            <LogoMark className="size-12" />
            <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight">You're invited to a space</h1>
            <p className="mt-2 text-zinc-400">Add songs, vote on what plays next, and watch the queue change live. No account needed.</p>

            <form
              className="mt-7"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim()) join.mutate()
              }}
            >
              <label htmlFor="nickname" className="text-sm font-medium text-zinc-300">
                Your nickname
              </label>
              <input
                id="nickname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                autoFocus
                autoComplete="nickname"
                placeholder="e.g. Riya"
                className="mt-2 h-13 w-full rounded-2xl bg-black/30 px-5 text-base ring-1 ring-white/10 transition outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-fuchsia-400/60"
              />
              {join.isError ? <p className="mt-2 text-sm text-rose-300">{join.error.message}</p> : null}
              <Button type="submit" size="lg" className="mt-4 w-full" loading={join.isPending} disabled={!name.trim()}>
                Join the party <Icon name="arrowRight" className="size-5" />
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-zinc-500">
              Hosting this space?{' '}
              <a href={spotifyLoginUrl(location.pathname)} className="font-semibold text-zinc-300 underline-offset-4 hover:text-white hover:underline">
                Log in with Spotify
              </a>
            </p>
          </div>
        </div>
      </main>
    </>
  )
}
