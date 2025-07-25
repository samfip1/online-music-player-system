import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, skipThreshold, type QueueState } from '../../lib/api'
import { useToast } from '../toast'
import { Icon, Spinner } from '../ui'

/**
 * "Vote to skip" for the song playing now (phase 17). The threshold follows the live head count,
 * using the same formula as the server, which makes the real decision.
 */
export function SkipVote({ spaceId, state, present }: { spaceId: string; state: QueueState; present: number | null }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const skip = useMutation({
    mutationFn: () => api<{ votes: number; needed: number; skipped: boolean }>(`/spaces/${spaceId}/skip-vote`, { method: 'POST' }),
    onSuccess: (r) => {
      if (!r.skipped) toast(`Skip vote counted: ${r.votes} of ${r.needed}`, 'info')
    },
    onError: (err) => toast(err.message, 'error'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['queue', spaceId] }),
  })
  if (!state.skip) return null

  const { votes, voted } = state.skip
  const needed = present === null ? state.skip.needed : skipThreshold(present)
  return (
    <button
      onClick={() => skip.mutate()}
      disabled={voted || skip.isPending}
      className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm ring-1 transition ${
        voted ? 'bg-rose-500/10 text-rose-200 ring-rose-400/20' : 'bg-white/[0.04] text-zinc-300 ring-white/10 hover:bg-white/[0.08] hover:text-white'
      }`}
    >
      {skip.isPending ? <Spinner className="size-4" /> : <Icon name="skip" className="size-4" />}
      <span className="font-semibold">{voted ? 'You voted to skip' : 'Vote to skip'}</span>
      <span className="ml-auto flex items-center gap-2 text-xs tabular-nums">
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
          <span className="block h-full rounded-full bg-rose-400 transition-all" style={{ width: `${Math.min(100, (votes / needed) * 100)}%` }} />
        </span>
        {votes}/{needed}
      </span>
    </button>
  )
}
