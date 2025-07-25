import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, MAX_QUEUE_RANGE, VOTE_LIMIT_RANGE, type SpaceDetail } from '../../lib/api'
import { useToast } from '../toast'
import { Button, Dialog, Icon } from '../ui'

/** Host settings per space (phase 18). */
export function SettingsButton({ space }: { space: SpaceDetail }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="sliders" className="size-4" /> <span className="hidden sm:inline">Settings</span>
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Space settings">
        {/* Keyed so the form resets to the saved values each time it opens. */}
        {open ? <SettingsForm key={String(open)} space={space} onDone={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  )
}

function SettingsForm({ space, onDone }: { space: SpaceDetail; onDone: () => void }) {
  const [name, setName] = useState(space.name)
  const [maxQueue, setMaxQueue] = useState(space.maxQueue)
  const [voteLimit, setVoteLimit] = useState(space.voteLimit)
  const [queueLocked, setQueueLocked] = useState(space.queueLocked)
  const toast = useToast()
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: () => api(`/spaces/${space.id}`, { method: 'PATCH', body: { name: name.trim(), maxQueue, voteLimit, queueLocked } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['space', space.id] })
      toast('Settings saved', 'success')
      onDone()
    },
    onError: (err) => toast(err.message, 'error'),
  })

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <label className="block">
        <span className="text-sm font-medium text-zinc-300">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
          className="mt-2 h-11 w-full rounded-2xl bg-black/30 px-4 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-fuchsia-400/60"
        />
      </label>
      <Stepper label="Queue size" hint="Most songs waiting at once" value={maxQueue} onChange={setMaxQueue} {...MAX_QUEUE_RANGE} />
      <Stepper label="Votes per person" hint="Before the cooldown starts. Applies from each person's next vote." value={voteLimit} onChange={setVoteLimit} {...VOTE_LIMIT_RANGE} />
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-medium text-zinc-300">Lock the queue</span>
          <span className="block text-xs text-zinc-500">Only you can add songs. Everyone can still vote.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={queueLocked}
          onChange={(e) => setQueueLocked(e.target.checked)}
          className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-white/15 transition before:absolute before:top-0.5 before:left-0.5 before:size-5 before:rounded-full before:bg-white before:transition checked:bg-fuchsia-500 checked:before:translate-x-5"
        />
      </label>
      <p className="text-xs text-zinc-500">Cooldown length stays 5 minutes (4 for Pro members).</p>
      <Button type="submit" size="lg" className="w-full" loading={save.isPending} disabled={!name.trim()}>
        Save
      </Button>
    </form>
  )
}

function Stepper({ label, hint, value, onChange, min, max }: { label: string; hint: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-zinc-300">{label}</span>
        <span className="block text-xs text-zinc-500">{hint}</span>
      </span>
      <div className="flex shrink-0 items-center gap-1 rounded-2xl bg-white/[0.05] p-1 ring-1 ring-white/10">
        <button type="button" onClick={() => set(value - 1)} disabled={value <= min} aria-label={`Fewer: ${label}`} className="grid size-8 place-items-center rounded-xl hover:bg-white/10 disabled:opacity-30">
          −
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          aria-label={label}
          onChange={(e) => set(Number(e.target.value) || min)}
          className="w-10 bg-transparent text-center font-bold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button type="button" onClick={() => set(value + 1)} disabled={value >= max} aria-label={`More: ${label}`} className="grid size-8 place-items-center rounded-xl hover:bg-white/10 disabled:opacity-30">
          +
        </button>
      </div>
    </div>
  )
}
