import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { api, type Me, type PlayerState, type Presence, type Reaction } from './api'

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false, staleTime: 60_000 })
}

export function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** Current time, re-rendering every `ms` while enabled. */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms, enabled])
  return now
}

/**
 * Joins the space's Socket.IO room. "queue:changed" refetches the queue and history (no polling).
 * "player:state" is the host's playback position, stamped with when it arrived.
 * Reactions and "skipped" are passed to callbacks, since they're one-off moments, not state.
 */
export function useSpaceSocket(
  spaceId: string,
  enabled: boolean,
  on: { reaction?: (r: Reaction) => void; skipped?: (title: string) => void } = {},
) {
  const queryClient = useQueryClient()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [presence, setPresence] = useState<Presence | null>(null)
  const [playerState, setPlayerState] = useState<(PlayerState & { receivedAt: number }) | null>(null)
  const handlers = useRef(on)
  useLayoutEffect(() => {
    handlers.current = on
  })

  useEffect(() => {
    if (!enabled) return
    const s = io({ withCredentials: true })
    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: ['queue', spaceId] })
      void queryClient.invalidateQueries({ queryKey: ['history', spaceId] })
      void queryClient.invalidateQueries({ queryKey: ['space', spaceId] }) // name/settings changes
    }
    s.on('connect', () => {
      setConnected(true)
      s.emit('join', spaceId)
      refetch() // catch up on anything missed while disconnected
    })
    s.on('disconnect', () => setConnected(false))
    s.on('queue:changed', refetch)
    s.on('presence', setPresence)
    s.on('removed', () => {
      setRemoved(true)
      s.close()
    })
    s.on('reaction', (r: Reaction) => handlers.current.reaction?.(r))
    s.on('skipped', ({ title }: { title: string }) => handlers.current.skipped?.(title))
    s.on('player:state', (state: PlayerState) => setPlayerState({ ...state, receivedAt: Date.now() }))
    setSocket(s)
    return () => {
      s.close()
      setSocket(null)
      setConnected(false)
    }
  }, [spaceId, enabled, queryClient])

  return { socket, connected, playerState, presence, removed }
}

/**
 * FLIP animation for reordering lists: rows glide to their new position when votes change the order.
 * Uses offsetTop (not viewport rects) so page scrolling never triggers animations.
 */
export function useFlip(orderKey: string) {
  const elements = useRef(new Map<string, HTMLElement>())
  const positions = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, number>()
    elements.current.forEach((el, key) => next.set(key, el.offsetTop))
    if (!reduce) {
      elements.current.forEach((el, key) => {
        const before = positions.current.get(key)
        const after = next.get(key)!
        if (before === undefined) {
          if (positions.current.size > 0) el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 260)
        } else if (before !== after) {
          el.animate([{ transform: `translateY(${before - after}px)` }, { transform: 'none' }], {
            duration: 420,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          })
        }
      })
    }
    positions.current = next
  }, [orderKey])

  return (key: string) => (el: HTMLElement | null) => {
    if (el) elements.current.set(key, el)
    else elements.current.delete(key)
  }
}
