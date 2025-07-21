import type { Me, Quota } from '../../lib/api'
import { duration } from '../../lib/format'
import { useNow } from '../../lib/hooks'
import { UpgradeButton } from '../billing'
import { Card, Icon, ProBadge } from '../ui'

// Mirrors server/src/config.ts. Only used to draw the countdown ring; the server enforces the real rule.
const COOLDOWN_FREE_MS = 300_000
const COOLDOWN_PAID_MS = 240_000

/** The quota as it is right now: a lock that has run out means a fresh set of votes (same rule as the server). */
export function effectiveQuota(quota: Quota, now: number): Quota {
  if (quota.lockedUntil && new Date(quota.lockedUntil).getTime() <= now) {
    return { ...quota, votesUsed: 0, votesLeft: quota.limit, lockedUntil: null }
  }
  return quota
}

export function QuotaCard({ quota: serverQuota, me }: { quota: Quota; me: Me }) {
  const now = useNow(1000, Boolean(serverQuota.lockedUntil))
  const quota = effectiveQuota(serverQuota, now)
  const locked = Boolean(quota.lockedUntil)
  const remainingMs = locked ? new Date(quota.lockedUntil!).getTime() - now : 0
  const cooldown = me.isPro ? COOLDOWN_PAID_MS : COOLDOWN_FREE_MS

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4">
        {locked ? (
          <div className="flex items-center gap-4">
            <CountdownRing fraction={remainingMs / cooldown} label={duration(remainingMs)} />
            <div>
              <p className="font-semibold">Out of votes</p>
              <p className="text-sm text-zinc-400">New votes in {duration(remainingMs)}</p>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-zinc-400">Votes left</p>
            <p className="font-display text-3xl font-extrabold tabular-nums">
              {quota.votesLeft}
              <span className="text-lg text-zinc-500">/{quota.limit}</span>
            </p>
          </div>
        )}
        {!locked ? (
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: quota.limit }, (_, i) => (
              <span key={i} className={`h-8 w-2.5 rounded-full transition-all duration-500 ${i < quota.votesLeft ? 'bg-brand shadow-md shadow-fuchsia-600/40' : 'bg-white/10'}`} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-zinc-500">
        <p className="flex gap-2">
          <Icon name="clock" className="mt-0.5 size-3.5 shrink-0" />
          {me.isPro ? (
            <span className="flex items-center gap-1.5">
              <ProBadge /> 4-minute cooldown after {quota.limit} votes
            </span>
          ) : (
            <span>
              {Math.round(cooldown / 60_000)}-minute cooldown after {quota.limit} votes (up or down). Removing a vote doesn't give it back.
            </span>
          )}
        </p>
        {me.billingEnabled && !me.isGuest && !me.isPro ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span>Pro: 4-minute cooldown, and downvotes on your songs count less.</span>
            <UpgradeButton size="sm" />
          </div>
        ) : null}
      </div>
    </Card>
  )
}

function CountdownRing({ fraction, label }: { fraction: number; label: string }) {
  const r = 26
  const circumference = 2 * Math.PI * r
  return (
    <div className="relative grid size-16 place-items-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="url(#ring)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, fraction)))}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className="text-xs font-bold tabular-nums">{label}</span>
    </div>
  )
}
