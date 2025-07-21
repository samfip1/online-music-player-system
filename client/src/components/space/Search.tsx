import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, type QueueState, type Track } from '../../lib/api'
import { artists, duration } from '../../lib/format'
import { useDebounced } from '../../lib/hooks'
import { useToast } from '../toast'
import { AlbumArt, Card, Icon, Spinner } from '../ui'

export function Search({ spaceId, state, isHost }: { spaceId: string; state: QueueState; isHost: boolean }) {
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 300)
  const input = useRef<HTMLInputElement>(null)

  // "/" focuses search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === '/' && !typing) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useQuery({
    queryKey: ['search', q],
    queryFn: () => api<Track[]>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
    staleTime: 5 * 60_000,
    retry: 1, // show the error quickly instead of retrying for ~7s
    placeholderData: keepPreviousData,
  })

  const queued = new Set(state.queue.map((i) => i.trackId))
  const full = state.queue.length >= state.settings.maxQueue
  const locked = state.settings.queueLocked && !isHost
  const loading = results.isFetching || (text.trim() !== q && text.trim().length > 0)

  return (
    <Card className="p-3 sm:p-4">
      <label className="relative flex items-center">
        <Icon name="search" className="pointer-events-none absolute left-4 size-5 text-zinc-500" />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setText('')}
          placeholder={locked ? 'The host locked the queue' : 'Search songs or artists'}
          disabled={locked}
          aria-label="Search Spotify"
          className="h-13 w-full rounded-2xl disabled:cursor-not-allowed disabled:opacity-60 bg-black/30 pr-12 pl-12 text-base ring-1 ring-white/10 transition outline-none placeholder:text-zinc-500 focus:bg-black/40 focus:ring-2 focus:ring-fuchsia-400/60"
        />
        <span className="absolute right-3 flex items-center">
          {loading ? (
            <Spinner className="size-5 text-fuchsia-300" />
          ) : text ? (
            <button onClick={() => setText('')} aria-label="Clear search" className="grid size-7 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white">
              <Icon name="x" className="size-4" />
            </button>
          ) : (
            <kbd className="hidden rounded-md bg-white/[0.06] px-2 py-0.5 font-sans text-xs text-zinc-500 ring-1 ring-white/10 sm:block">/</kbd>
          )}
        </span>
      </label>

      {q && results.isError ? (
        <p className="px-3 py-6 text-center text-sm text-rose-300">Search isn't working right now. Try again in a moment.</p>
      ) : q && results.data ? (
        results.data.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-500">No songs found for “{q}”.</p>
        ) : (
          <ul className={`scrollbar-thin mt-2 max-h-[26rem] space-y-0.5 overflow-y-auto transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {results.data.map((track) => (
              <SearchResult key={track.trackId} spaceId={spaceId} track={track} inQueue={queued.has(track.trackId)} full={full} />
            ))}
          </ul>
        )
      ) : null}
    </Card>
  )
}

function SearchResult({ spaceId, track, inQueue, full }: { spaceId: string; track: Track; inQueue: boolean; full: boolean }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const add = useMutation({
    mutationFn: () => api(`/spaces/${spaceId}/queue`, { method: 'POST', body: { trackId: track.trackId } }),
    onSuccess: () => {
      toast(`Added “${track.title}”`, 'success')
      return queryClient.invalidateQueries({ queryKey: ['queue', spaceId] })
    },
    onError: (err) => toast(err.message, 'error'),
  })

  const label = inQueue ? 'In queue' : full ? 'Queue full' : 'Add'

  return (
    <li className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-white/[0.05]">
      <AlbumArt url={track.albumArtUrl} className="size-11" rounded="rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{track.title}</p>
        <p className="truncate text-xs text-zinc-400">
          {artists(track.artists)} <span className="text-zinc-600">·</span> <span className="tabular-nums">{duration(track.durationMs)}</span>
        </p>
      </div>
      <button
        onClick={() => add.mutate()}
        disabled={inQueue || full || add.isPending}
        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition active:scale-95 disabled:cursor-default ${
          inQueue ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.08] text-white ring-1 ring-white/10 hover:bg-brand hover:ring-0 disabled:opacity-40'
        }`}
      >
        {add.isPending ? <Spinner className="size-4" /> : <Icon name={inQueue ? 'check' : 'plus'} className="size-4" strokeWidth={2.5} />}
        {label}
      </button>
    </li>
  )
}
