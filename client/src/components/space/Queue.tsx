import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError, PRO_DOWNVOTE_WEIGHT, type QueueItem, type QueueState, type Quota } from '../../lib/api'
import { artists, duration } from '../../lib/format'
import { useFlip } from '../../lib/hooks'
import { useToast } from '../toast'
import { AlbumArt, Avatar, Button, Card, Equalizer, Icon, IconButton, ProBadge } from '../ui'

type Props = { spaceId: string; state: QueueState; locked: boolean; isHost: boolean }

export function Queue({ spaceId, state, locked, isHost }: Props) {
  const { queue, settings } = state
  const flipRef = useFlip(queue.map((i) => `${i.id}:${i.score}`).join('|'))
  const vote = useVoteMutation(spaceId)

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 sm:px-6">
        <div>
          <h2 className="font-display text-xl font-bold">Up next</h2>
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            {queue.length}/{settings.maxQueue} songs · highest score plays next
            {settings.queueLocked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-300">
                <Icon name="lock" className="size-3" /> Locked
              </span>
            ) : null}
          </p>
        </div>
        {isHost && queue.length > 0 ? <ClearQueue spaceId={spaceId} /> : null}
      </div>

      {queue.length === 0 ? (
        <div className="grid place-items-center px-6 pt-6 pb-12 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-white/[0.05] text-zinc-500 ring-1 ring-white/10">
            <Icon name="music" className="size-6" />
          </span>
          <p className="mt-4 font-semibold">The queue is empty</p>
          <p className="mt-1 text-sm text-zinc-500">{settings.queueLocked && !isHost ? 'The host is picking the songs.' : 'Search above to add the first song.'}</p>
        </div>
      ) : (
        <ol className="relative space-y-1 px-2 pb-3 sm:px-3">
          {queue.map((item, index) => (
            <QueueRow
              key={item.id}
              ref={flipRef(item.id)}
              item={item}
              rank={index + 1}
              locked={locked}
              isHost={isHost}
              spaceId={spaceId}
              onVote={(value) => vote.mutate({ item, value })}
            />
          ))}
        </ol>
      )}
    </Card>
  )
}

function QueueRow({
  ref,
  item,
  rank,
  locked,
  isHost,
  spaceId,
  onVote,
}: {
  ref: (el: HTMLLIElement | null) => void
  item: QueueItem
  rank: number
  locked: boolean
  isHost: boolean
  spaceId: string
  /** 1 or −1 to vote that way, null to remove my vote */
  onVote: (value: 1 | -1 | null) => void
}) {
  const first = rank === 1
  return (
    <li
      ref={ref}
      className={`group relative flex items-center gap-3 rounded-2xl p-2.5 transition sm:gap-4 sm:p-3 ${
        first ? 'bg-gradient-to-r from-fuchsia-500/[0.12] to-violet-500/[0.04] ring-1 ring-fuchsia-400/20' : 'hover:bg-white/[0.04]'
      } ${item.score < 0 ? 'opacity-60 hover:opacity-100' : ''}`}
    >
      <span className="hidden w-5 text-center text-sm font-bold text-zinc-500 tabular-nums sm:block">{rank}</span>
      <div className="relative">
        <AlbumArt url={item.albumArtUrl} className="size-12 sm:size-14" />
        {first ? (
          <span className="absolute -top-1.5 -left-1.5 rounded-full bg-brand px-1.5 py-px text-[9px] font-extrabold tracking-wider text-white uppercase shadow sm:hidden">
            Next
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 font-semibold">
          <span className="min-w-0 truncate">{item.title}</span>
          {first ? (
            <span className="hidden shrink-0 rounded-full bg-fuchsia-400/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-fuchsia-200 uppercase sm:inline">
              Plays next
            </span>
          ) : null}
        </p>
        <p className="truncate text-sm text-zinc-400">{artists(item.artists)}</p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
          <Avatar name={item.addedBy.displayName} url={item.addedBy.avatarUrl} className="size-4 text-[8px]" />
          <span className="min-w-0 truncate">{item.addedBy.displayName}</span>
          {item.addedBy.isPro ? <ProBadge /> : null}
          {item.protected ? (
            <span title={`Pro: downvotes on this song count ${PRO_DOWNVOTE_WEIGHT}× `} className="text-amber-300/80">
              <Icon name="shield" className="size-3.5" />
            </span>
          ) : null}
          <span className="text-zinc-600">·</span>
          <span className="tabular-nums">{duration(item.durationMs)}</span>
        </p>
      </div>

      {isHost ? <RemoveSong spaceId={spaceId} itemId={item.id} /> : null}
      <VoteControl item={item} locked={locked} onVote={onVote} />
    </li>
  )
}

function VoteControl({ item, locked, onVote }: { item: QueueItem; locked: boolean; onVote: (value: 1 | -1 | null) => void }) {
  const { myVote, score, upvotes, downvotes } = item
  // Voting (or switching direction) needs a vote left; removing my own vote never does.
  const button = (value: 1 | -1) => {
    const active = myVote === value
    const disabled = locked && !active
    return (
      <button
        onClick={() => onVote(active ? null : value)}
        disabled={disabled}
        aria-pressed={active}
        aria-label={active ? `Remove your ${value > 0 ? 'upvote' : 'downvote'}` : value > 0 ? 'Upvote' : 'Downvote'}
        title={disabled ? 'Out of votes, wait for the cooldown' : active ? 'Remove vote (it still counts toward your limit)' : value > 0 ? 'Upvote' : 'Downvote'}
        className={`grid h-9 w-9 place-items-center rounded-xl transition active:scale-90 disabled:cursor-not-allowed disabled:opacity-35 ${
          active
            ? value > 0
              ? 'bg-brand text-white shadow-lg shadow-fuchsia-600/30'
              : 'bg-rose-500/80 text-white shadow-lg shadow-rose-600/30'
            : 'text-zinc-400 hover:bg-white/[0.08] hover:text-white'
        }`}
      >
        <Icon name={value > 0 ? 'up' : 'down'} className="size-4" strokeWidth={2.75} />
      </button>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-2xl bg-white/[0.05] p-1 ring-1 ring-white/10" title={`${upvotes} up · ${downvotes} down`}>
      {button(1)}
      <span
        key={score}
        className={`min-w-[2.25rem] animate-pop text-center text-sm font-bold tabular-nums ${score < 0 ? 'text-rose-300' : score > 0 ? 'text-white' : 'text-zinc-400'}`}
      >
        {Number.isInteger(score) ? score : score.toFixed(1)}
      </span>
      {button(-1)}
    </div>
  )
}

/** Optimistic score using the same weights as the server, so the number doesn't jump when it replies. */
function withMyVote(item: QueueItem, value: 1 | -1 | null): QueueItem {
  const up = item.upvotes - (item.myVote === 1 ? 1 : 0) + (value === 1 ? 1 : 0)
  const down = item.downvotes - (item.myVote === -1 ? 1 : 0) + (value === -1 ? 1 : 0)
  const weight = item.protected ? PRO_DOWNVOTE_WEIGHT : 1
  return { ...item, upvotes: up, downvotes: down, score: Math.round((up - down * weight) * 100) / 100, myVote: value }
}

/** Vote / switch / unvote with an optimistic update so the buttons respond instantly; the server's answer then replaces it. */
function useVoteMutation(spaceId: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const key = ['queue', spaceId]

  return useMutation({
    mutationFn: ({ item, value }: { item: QueueItem; value: 1 | -1 | null }) =>
      value === null
        ? api<{ quota: Quota }>(`/spaces/${spaceId}/queue/${item.id}/vote`, { method: 'DELETE' })
        : api<{ quota: Quota }>(`/spaces/${spaceId}/queue/${item.id}/vote`, { method: 'POST', body: { value } }),
    onMutate: async ({ item, value }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<QueueState>(key)
      if (previous) {
        const spends = value !== null // every new vote or switch uses one
        queryClient.setQueryData<QueueState>(key, {
          ...previous,
          queue: previous.queue.map((i) => (i.id === item.id ? withMyVote(i, value) : i)),
          quota: spends ? { ...previous.quota, votesUsed: previous.quota.votesUsed + 1, votesLeft: Math.max(0, previous.quota.votesLeft - 1) } : previous.quota,
        })
      }
      return { previous }
    },
    onSuccess: ({ quota }, { value }) => {
      if (value !== null && quota.votesLeft === 0) toast('That was your last vote. New votes after the cooldown.', 'info')
      if (value === null) toast(`Vote removed. It still counts toward your ${quota.limit}.`, 'info')
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast(err instanceof ApiError && err.status === 429 ? "You're out of votes. Wait for the countdown." : err.message, 'error')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

function RemoveSong({ spaceId, itemId }: { spaceId: string; itemId: string }) {
  const toast = useToast()
  const remove = useMutation({
    mutationFn: () => api(`/spaces/${spaceId}/queue/${itemId}`, { method: 'DELETE' }),
    onError: (err) => toast(err.message, 'error'),
  })
  return (
    <IconButton
      icon="x"
      label="Remove song"
      disabled={remove.isPending}
      onClick={() => remove.mutate()}
      className="hover:text-rose-300 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
    />
  )
}

function ClearQueue({ spaceId }: { spaceId: string }) {
  const [confirming, setConfirming] = useState(false)
  const toast = useToast()
  const clear = useMutation({
    mutationFn: () => api(`/spaces/${spaceId}/queue`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirming(false)
      toast('Queue cleared', 'success')
    },
    onError: (err) => toast(err.message, 'error'),
  })
  return confirming ? (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <Button variant="danger" size="sm" loading={clear.isPending} onClick={() => clear.mutate()}>
        Clear all
      </Button>
    </div>
  ) : (
    <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
      <Icon name="trash" className="size-4" /> Clear
    </Button>
  )
}

export function QueueSkeleton() {
  return (
    <Card className="space-y-2 p-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 p-2">
          <div className="size-14 animate-pulse rounded-lg bg-white/[0.06]" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.04]" />
          </div>
          <Equalizer className="h-4 text-white/10" playing={false} />
        </div>
      ))}
    </Card>
  )
}
