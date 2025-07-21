import type { ReactNode } from 'react'
import type { NowPlaying as NowPlayingItem, PlayerState } from '../../lib/api'
import { artists, duration } from '../../lib/format'
import { useNow } from '../../lib/hooks'
import { AlbumArt, Avatar, Card, Equalizer, Icon, ProBadge } from '../ui'

export type TimedPlayerState = PlayerState & { receivedAt: number }

/** Where playback is right now, from the last known state plus the time since it arrived. */
export function livePosition(state: TimedPlayerState | null, itemId: string | undefined, now: number) {
  if (!state || !itemId || state.itemId !== itemId) return null
  return { paused: state.paused, positionMs: state.paused ? state.positionMs : state.positionMs + (now - state.receivedAt) }
}

type Props = {
  item: NowPlayingItem | null
  player: TimedPlayerState | null
  isHost: boolean
  /** Floating reactions, drawn over the card */
  overlay?: ReactNode
  /** Reactions and the skip vote, under the song */
  children?: ReactNode
}

export function NowPlaying({ item, player, isHost, overlay, children }: Props) {
  const now = useNow(500, Boolean(item && player && !player.paused))
  const live = livePosition(player, item?.id, now)

  if (!item) {
    return (
      <Card className="flex items-center gap-4 p-5">
        <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white/[0.05] text-zinc-500 ring-1 ring-white/10">
          <Equalizer className="h-6" playing={false} />
        </span>
        <div>
          <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Nothing playing</p>
          <p className="mt-1 text-sm text-zinc-400">
            {isHost ? 'Add a few songs, then start the player below.' : 'Add songs and vote. Music starts when the host hits play.'}
          </p>
        </div>
      </Card>
    )
  }

  const progress = live ? Math.min(1, live.positionMs / item.durationMs) : null
  const playing = live ? !live.paused : true

  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="flex gap-4 lg:block">
        <div className="relative shrink-0">
          <AlbumArt url={item.albumArtUrl} className="size-24 shadow-2xl shadow-black/60 sm:size-28 lg:aspect-square lg:size-auto lg:w-full" rounded="rounded-2xl" />
        </div>
        <div className="min-w-0 flex-1 lg:mt-5">
          <p className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-fuchsia-300 uppercase">
            <Equalizer className="h-3" bars={3} playing={playing} />
            {live?.paused ? 'Paused' : 'Now playing'}
          </p>
          <h2 className="mt-1.5 line-clamp-2 font-display text-xl leading-tight font-bold sm:text-2xl">{item.title}</h2>
          <p className="mt-0.5 truncate text-zinc-400">{artists(item.artists)}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
            <Avatar name={item.addedBy.displayName} url={item.addedBy.avatarUrl} className="size-4 text-[8px]" />
            Added by <span className="text-zinc-300">{item.addedBy.displayName}</span>
            {item.addedBy.isPro ? <ProBadge /> : null}
            {item.score !== 0 ? (
              <>
                <span className="text-zinc-600">·</span>
                <Icon name={item.score > 0 ? 'up' : 'down'} className="size-3" strokeWidth={3} /> {Math.abs(item.score)}
              </>
            ) : null}
          </p>
        </div>
      </div>

      {progress !== null && live ? (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500 ease-linear" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-zinc-500 tabular-nums">
            <span>{duration(Math.min(live.positionMs, item.durationMs))}</span>
            <span>{duration(item.durationMs)}</span>
          </div>
        </div>
      ) : null}
      {children ? <div className="mt-4 space-y-3 border-t border-line pt-4">{children}</div> : null}
      {overlay}
    </Card>
  )
}
