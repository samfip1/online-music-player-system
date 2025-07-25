import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Presence, type PublicUser } from '../../lib/api'
import { useToast } from '../toast'
import { Avatar, Button, Dialog, Icon, ProBadge } from '../ui'

/** "12 here" pill that opens the people list. The host can remove people and let them back in (phase 15). */
export function People({ spaceId, presence, hostId, meId }: { spaceId: string; presence: Presence | null; hostId: string; meId: string }) {
  const [open, setOpen] = useState(false)
  const isHost = meId === hostId
  const people = [...(presence?.users ?? [])].sort((a, b) => Number(b.id === hostId) - Number(a.id === hostId) || a.displayName.localeCompare(b.displayName))

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:text-white"
        aria-label={`${presence?.count ?? 0} people here`}
      >
        <Icon name="users" className="size-4" />
        <span className="tabular-nums">{presence?.count ?? '–'}</span>
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title={`${presence?.count ?? 0} here now`}>
        <ul className="scrollbar-thin -mx-2 max-h-[50vh] space-y-0.5 overflow-y-auto">
          {people.map((user) => (
            <PersonRow key={user.id} spaceId={spaceId} user={user} isHostRow={user.id === hostId} isMe={user.id === meId} canRemove={isHost && user.id !== meId} />
          ))}
        </ul>
        {isHost ? <RemovedPeople spaceId={spaceId} /> : null}
        {isHost ? (
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">
            Removing someone blocks their account from this space and cancels their votes on waiting songs. Guests could rejoin under a new name from a
            private window, so this stops casual trolls, not determined ones.
          </p>
        ) : null}
      </Dialog>
    </>
  )
}

function PersonRow({ spaceId, user, isHostRow, isMe, canRemove }: { spaceId: string; user: PublicUser; isHostRow: boolean; isMe: boolean; canRemove: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const toast = useToast()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api(`/spaces/${spaceId}/bans`, { method: 'POST', body: { userId: user.id } }),
    onSuccess: () => {
      toast(`Removed ${user.displayName}`, 'success')
      return queryClient.invalidateQueries({ queryKey: ['bans', spaceId] })
    },
    onError: (err) => toast(err.message, 'error'),
  })

  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04]">
      <Avatar name={user.displayName} url={user.avatarUrl} className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-medium">
          <span className="min-w-0 truncate">{user.displayName}</span>
          {user.isPro ? <ProBadge /> : null}
          {isMe ? <span className="text-xs text-zinc-500">(you)</span> : null}
        </p>
        <p className="text-xs text-zinc-500">{isHostRow ? 'Host' : user.isGuest ? 'Guest' : 'Spotify'}</p>
      </div>
      {canRemove ? (
        confirming ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} className="text-zinc-400 hover:text-rose-300">
            <Icon name="ban" className="size-4" /> Remove
          </Button>
        )
      ) : null}
    </li>
  )
}

function RemovedPeople({ spaceId }: { spaceId: string }) {
  const queryClient = useQueryClient()
  const bans = useQuery({ queryKey: ['bans', spaceId], queryFn: () => api<(PublicUser & { bannedAt: string })[]>(`/spaces/${spaceId}/bans`) })
  const allow = useMutation({
    mutationFn: (userId: string) => api(`/spaces/${spaceId}/bans/${userId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bans', spaceId] }),
  })
  if (!bans.data?.length) return null
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-xs font-semibold tracking-widest text-zinc-500 uppercase">Removed</h3>
      <ul className="space-y-0.5">
        {bans.data.map((user) => (
          <li key={user.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
            <Avatar name={user.displayName} url={user.avatarUrl} className="size-7 opacity-60" />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">{user.displayName}</span>
            <Button variant="ghost" size="sm" loading={allow.isPending && allow.variables === user.id} onClick={() => allow.mutate(user.id)}>
              Allow back
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
