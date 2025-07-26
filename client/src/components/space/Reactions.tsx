import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { REACTIONS, type Reaction } from '../../lib/api'

// Floating emoji reactions over the now-playing card (phase 13). Nothing is stored.

type Floating = Reaction & { id: number; x: number; drift: number; duration: number }

const MAX_ON_SCREEN = 30 // so a burst can't freeze a phone
let nextId = 1

export function useFloatingReactions() {
  const [items, setItems] = useState<Floating[]>([])
  const [recent, setRecent] = useState<string[]>([]) // reduced-motion fallback

  const add = useCallback((r: Reaction) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRecent((list) => [r.emoji, ...list].slice(0, 5))
      return
    }
    const item: Floating = { ...r, id: nextId++, x: 10 + Math.random() * 80, drift: (Math.random() - 0.5) * 60, duration: 2200 + Math.random() * 900 }
    setItems((list) => [...list.slice(-(MAX_ON_SCREEN - 1)), item])
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== item.id)), item.duration)
  }, [])

  return { items, recent, add }
}

export function FloatingReactions({ items, recent }: { items: Floating[]; recent: string[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {items.map((r) => (
        <FloatingEmoji key={r.id} item={r} />
      ))}
      {recent.length ? <div className="absolute top-3 right-3 rounded-full bg-black/50 px-2 py-1 text-sm">{recent.join(' ')}</div> : null}
    </div>
  )
}

/** Animates once when it appears (a ref callback would restart the animation on every re-render). */
function FloatingEmoji({ item }: { item: Floating }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    ref.current?.animate(
      [
        { transform: 'translate(-50%, 0) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -30px) scale(1.15)', opacity: 1, offset: 0.15 },
        { transform: `translate(calc(-50% + ${item.drift}px), -260px) scale(1)`, opacity: 0 },
      ],
      { duration: item.duration, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' },
    )
  }, [item])
  return (
    <span ref={ref} className="absolute bottom-16 text-3xl opacity-0 drop-shadow-lg" style={{ left: `${item.x}%` }}>
      {item.emoji}
    </span>
  )
}

export function ReactionBar({ spaceId, socket, disabled }: { spaceId: string; socket: Socket | null; disabled?: boolean }) {
  const last = useRef(0)
  const send = (emoji: string) => {
    // Light client-side throttle; the server enforces the real limit and drops extras.
    if (Date.now() - last.current < 250) return
    last.current = Date.now()
    socket?.emit('reaction', { spaceId, emoji })
  }
  return (
    <div className="flex items-center justify-between gap-1" role="group" aria-label="React to this song">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => send(emoji)}
          disabled={disabled || !socket}
          aria-label={`React ${emoji}`}
          className="grid size-10 place-items-center rounded-full text-xl transition hover:scale-110 hover:bg-white/[0.08] active:scale-90 disabled:opacity-40"
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
