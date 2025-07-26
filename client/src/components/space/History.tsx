import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type HistoryItem, type QueueState } from '../../lib/api'
import { artists, timeAgo } from '../../lib/format'
import { useToast } from '../toast'
import { AlbumArt, Card, Icon, Spinner } from '../ui'

/** Recently played, collapsed by default. Refetched on the same socket event as the queue. */
export function History({ spaceId, state, isHost }: { spaceId: string; state: QueueState; isHost: boolean }) {
  const [open, setOpen] = useState(false)
  const history = useQuery({
    queryKey: ['history', spaceId],
    queryFn: () => api<HistoryItem[]>(`/spaces/${spaceId}/history`),
    enabled: open,
  })
  const queued = new Set(state.queue.map((i) => i.trackId))
  const canAdd = isHost || !state.settings.queueLocked

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-white/[0.03] sm:px-6">
        <Icon name="history" className="size-5 text-zinc-400" />
        <span className="flex-1 font-display text-lg font-bold">Recently played</span>
        <Icon name="down" className={`size-5 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        history.isPending ? (
          <div className="grid place-items-center pb-6 text-fuchsia-300">
            <Spinner />
          </div>
        ) : history.data?.length ? (
          <ol className="space-y-0.5 px-2 pb-3 sm:px-3">
            {history.data.map((item) => (
              <HistoryRow key={item.id} spaceId={spaceId} item={item} inQueue={queued.has(item.trackId)} canAdd={canAdd} />
            ))}
          </ol>
        ) : (
          <p className="px-6 pb-6 text-sm text-zinc-500">Songs show up here after they've played.</p>
        )
      ) : null}
    </Card>
  )
}

function HistoryRow({ spaceId, item, inQueue, canAdd }: { spaceId: string; item: HistoryItem; inQueue: boolean; canAdd: boolean }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  // Same endpoint as search, so the same limits and duplicate check apply.
  const add = useMutation({
    mutationFn: () => api(`/spaces/${spaceId}/queue`, { method: 'POST', body: { trackId: item.trackId } }),
    onSuccess: () => {
      toast(`Added “${item.title}” again`, 'success')
      return queryClient.invalidateQueries({ queryKey: ['queue', spaceId] })
    },
    onError: (err) => toast(err.message, 'error'),
  })
  return (
    <li className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-white/[0.04]">
      <AlbumArt url={item.albumArtUrl} className="size-10" rounded="rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{item.title}</p>
        <p className="truncate text-xs text-zinc-500">
          {artists(item.artists)} · {timeAgo(item.playedAt)}
        </p>
      </div>
      {canAdd ? (
        <button
          onClick={() => add.mutate()}
          disabled={inQueue || add.isPending}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
        >
          {add.isPending ? <Spinner className="size-3.5" /> : <Icon name={inQueue ? 'check' : 'plus'} className="size-3.5" strokeWidth={2.5} />}
          {inQueue ? 'In queue' : 'Add again'}
        </button>
      ) : null}
    </li>
  )
}
