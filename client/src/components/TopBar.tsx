import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, type Me } from '../lib/api'
import { UpgradeButton, usePendingPaymentSync } from './billing'
import { Avatar, Icon, Logo, ProBadge } from './ui'

export function TopBar({ me, children }: { me?: Me; children?: ReactNode }) {
  usePendingPaymentSync(me)
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Logo to={me && !me.isGuest ? '/home' : '/'} />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
        {me ? <UserMenu me={me} /> : null}
      </div>
    </header>
  )
}

function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.clear()
      navigate('/')
    },
  })

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full py-1 pr-1 pl-1 transition hover:bg-white/[0.07] sm:pr-3"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Avatar name={me.displayName} url={me.avatarUrl} />
        <span className="hidden max-w-32 truncate text-sm font-medium sm:block">{me.displayName}</span>
        {me.isPro ? <ProBadge className="hidden sm:inline-flex" /> : null}
      </button>

      {open ? (
        <div role="menu" className="absolute right-0 mt-2 w-64 animate-rise rounded-2xl bg-zinc-900/95 p-2 shadow-2xl shadow-black/60 ring-1 ring-white/10 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={me.displayName} url={me.avatarUrl} className="size-10" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-semibold">
                <span className="min-w-0 truncate">{me.displayName}</span> {me.isPro ? <ProBadge /> : null}
              </div>
              <div className="text-xs text-zinc-400">{me.isGuest ? 'Guest' : 'Spotify account'}</div>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          {!me.isGuest ? (
            <Link to="/home" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-white/[0.07]">
              <Icon name="home" className="size-4 text-zinc-400" /> Your spaces
            </Link>
          ) : null}
          {!me.isGuest ? (
            <Link to="/insights" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-white/[0.07]">
              <Icon name="chart" className="size-4 text-zinc-400" /> Insights
            </Link>
          ) : null}
          {me.isAdmin ? (
            <Link to="/admin" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-white/[0.07]">
              <Icon name="shield" className="size-4 text-zinc-400" /> Admin dashboard
            </Link>
          ) : null}
          {me.billingEnabled && !me.isGuest && !me.isPro ? (
            <div className="px-1 py-1.5">
              <UpgradeButton size="sm" className="w-full" />
            </div>
          ) : null}
          <button
            role="menuitem"
            onClick={() => logout.mutate()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/[0.07]"
          >
            <Icon name="logout" className="size-4 text-zinc-400" /> {me.isGuest ? 'Leave' : 'Log out'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
