import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Socket } from 'socket.io-client'
import { api, ApiError, spotifyLoginUrl, type PlayerState, type QueueState } from '../../lib/api'
import { useToast } from '../toast'
import { Button, buttonClass, Card, Equalizer, Icon, Spinner } from '../ui'
import type { TimedPlayerState } from './NowPlaying'

// The host's browser is the speaker: Spotify's Web Playback SDK plays here, and this component
// keeps it in sync with the queue. Song ends → POST /next → server picks the top song → socket
// → queue refetch → nowPlaying changes → this plays it.

type Status = 'idle' | 'connecting' | 'ready' | 'premium' | 'relogin' | 'unsupported'

let sdkLoaded: Promise<void> | null = null
function loadSdk() {
  sdkLoaded ??= new Promise<void>((resolve, reject) => {
    if (window.Spotify) return resolve()
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.onerror = () => {
      sdkLoaded = null
      reject(new Error("Couldn't load Spotify's player"))
    }
    document.body.append(script)
  })
  return sdkLoaded
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null
async function getToken() {
  if (!cachedToken || cachedToken.expiresAt <= Date.now()) {
    cachedToken = await api<{ accessToken: string; expiresAt: number }>('/spotify/player-token')
  }
  return cachedToken.accessToken
}

class PlayError extends Error {
  status: number
  constructor(status: number) {
    super(`Spotify couldn't start the song (${status})`)
    this.status = status
  }
}

/** Starts a track on our SDK device. The only direct browser → Spotify API call in the app. */
async function playOnDevice(deviceId: string, uri: string, attempt = 0): Promise<void> {
  const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri] }),
  })
  // A brand-new device can take a moment to register with Spotify.
  if (res.status === 404 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1200))
    return playOnDevice(deviceId, uri, attempt + 1)
  }
  if (!res.ok) throw new PlayError(res.status)
}

const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

type Props = {
  spaceId: string
  state: QueueState
  socket: Socket | null
  onState: (state: TimedPlayerState) => void
}

export function HostPlayer({ spaceId, state, socket, onState }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Status>('idle')
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [paused, setPaused] = useState(true)
  const [elsewhere, setElsewhere] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [sdkReady, setSdkReady] = useState(false)

  const player = useRef<Spotify.Player | null>(null)
  const loaded = useRef<{ itemId: string; uri: string } | null>(null) // what we asked Spotify to play
  const loading = useRef(false) // between asking Spotify to play and it actually playing
  const advancedFrom = useRef<string | null>(null) // item we already called /next for
  const previous = useRef<Spotify.PlaybackState | null>(null)
  const socketRef = useRef(socket)

  const nowPlaying = state.nowPlaying

  const next = useMutation({
    // reason tells the server whether the song ended or was skipped (host insights count skips).
    mutationFn: ({ currentItemId, reason }: { currentItemId: string | null; reason?: 'ended' | 'skipped' }) =>
      api(`/spaces/${spaceId}/next`, { method: 'POST', body: { currentItemId, reason } }),
    onError: (err) => toast(err.message, 'error'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['queue', spaceId] }),
  })
  const nextRef = useRef(next.mutate)

  const broadcast = useCallback(
    (paused: boolean, positionMs: number) => {
      const payload: PlayerState = { spaceId, itemId: loaded.current?.itemId ?? null, paused, positionMs: Math.max(0, Math.round(positionMs)) }
      socketRef.current?.emit('player:state', payload)
      onState({ ...payload, receivedAt: Date.now() })
    },
    [spaceId, onState],
  )

  const onPlayerState = useCallback(
    (s: Spotify.PlaybackState | null) => {
      if (!s) {
        // Playback was moved to another device (e.g. the Spotify app).
        setElsewhere(Boolean(loaded.current))
        return
      }
      setElsewhere(false)
      setPaused(s.paused)
      const before = previous.current
      previous.current = s
      broadcast(s.paused, s.position)

      const current = loaded.current
      if (!current) return
      const track = s.track_window.current_track
      const isOurs = track?.uri === current.uri || track?.linked_from?.uri === current.uri
      if (loading.current) {
        if (isOurs && !s.paused) loading.current = false
        return
      }
      // Finished: it stopped at 0 right after playing, or Spotify moved on to some other track (autoplay).
      const finished = !isOurs || (before !== null && !before.paused && s.paused && s.position === 0)
      if (finished && advancedFrom.current !== current.itemId) {
        advancedFrom.current = current.itemId
        nextRef.current({ currentItemId: current.itemId, reason: 'ended' })
      }
    },
    [broadcast],
  )
  // The SDK listeners are attached once; they call through these refs to always see the latest values.
  const onPlayerStateRef = useRef(onPlayerState)
  const toastRef = useRef(toast)
  useLayoutEffect(() => {
    socketRef.current = socket
    nextRef.current = next.mutate
    onPlayerStateRef.current = onPlayerState
    toastRef.current = toast
  })

  // Load the SDK and create the player up front, so "Start" can activate it inside the click itself
  // (browsers only allow audio to start from a user gesture).
  useEffect(() => {
    let cancelled = false
    loadSdk()
      .then(() => {
        if (cancelled) return
        const p = new window.Spotify.Player({
          name: 'SonicVote',
          volume: 0.8,
          getOAuthToken: (cb) => {
            getToken()
              .then(cb)
              .catch((err) => setStatus(err instanceof ApiError && err.body.code === 'spotify_relogin' ? 'relogin' : 'unsupported'))
          },
        })
        p.addListener('ready', ({ device_id }) => {
          setDeviceId(device_id)
          setStatus('ready')
        })
        p.addListener('not_ready', () => setDeviceId(null))
        p.addListener('account_error', () => setStatus('premium'))
        p.addListener('authentication_error', () => {
          cachedToken = null
          setStatus('relogin')
        })
        p.addListener('initialization_error', () => setStatus('unsupported'))
        p.addListener('playback_error', ({ message }) => toastRef.current(`Playback problem: ${message}`, 'error'))
        p.addListener('player_state_changed', (s) => onPlayerStateRef.current(s))
        player.current = p
        setSdkReady(true)
      })
      .catch(() => !cancelled && setStatus('unsupported'))
    return () => {
      cancelled = true
      player.current?.disconnect()
      player.current = null
    }
  }, [])

  const start = () => {
    const p = player.current
    if (!p) return
    void p.activateElement()
    setStatus('connecting')
    void p.connect().then((ok) => !ok && setStatus('unsupported'))
  }

  // Keep Spotify playing whatever the server says is now playing.
  useEffect(() => {
    if (status !== 'ready' || !deviceId) return
    if (!nowPlaying) {
      if (loaded.current) {
        loaded.current = null
        void player.current?.pause()
        broadcast(true, 0)
      }
      return
    }
    if (loaded.current?.itemId === nowPlaying.id) return
    loaded.current = { itemId: nowPlaying.id, uri: nowPlaying.trackUri }
    loading.current = true
    advancedFrom.current = null
    playOnDevice(deviceId, nowPlaying.trackUri).catch((err) => {
      loading.current = false
      if (err instanceof PlayError && err.status === 403) setStatus('premium')
      else toast(err.message, 'error')
    })
  }, [status, deviceId, nowPlaying, broadcast, toast])

  // Nothing playing but songs waiting (queue ran dry and someone added more): start the top one.
  const waiting = state.queue.length > 0
  useEffect(() => {
    if (status === 'ready' && deviceId && !nowPlaying && waiting) nextRef.current({ currentItemId: null })
  }, [status, deviceId, nowPlaying, waiting])

  // Heartbeat so listeners' progress bars stay accurate (and late joiners get the position).
  useEffect(() => {
    if (status !== 'ready' || paused) return
    const timer = setInterval(() => {
      void player.current?.getCurrentState().then((s) => s && broadcast(s.paused, s.position))
    }, 5000)
    return () => clearInterval(timer)
  }, [status, paused, broadcast])

  const skip = () => {
    if (!nowPlaying) return
    advancedFrom.current = nowPlaying.id
    next.mutate({ currentItemId: nowPlaying.id, reason: 'skipped' })
  }

  const resumeHere = () => {
    if (!deviceId || !nowPlaying) return
    loading.current = true
    playOnDevice(deviceId, nowPlaying.trackUri).catch((err) => toast(err.message, 'error'))
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold">Player</h2>
        <StatusPill status={status} />
      </div>

      {status === 'idle' ? (
        <div className="mt-3">
          <p className="text-sm text-zinc-400">This browser plays the music. Keep this tab open while the party is on.</p>
          {isMobile ? (
            <p className="mt-3 flex gap-2 rounded-xl bg-amber-400/10 p-3 text-xs text-amber-200 ring-1 ring-amber-300/20">
              <Icon name="alert" className="size-4 shrink-0" />
              Spotify's web player only works in desktop browsers. Open this page on a computer to play music.
            </p>
          ) : null}
          <Button size="lg" className="mt-4 w-full" onClick={start} disabled={!sdkReady}>
            <Icon name="play" className="size-4" /> Start the player
          </Button>
        </div>
      ) : status === 'connecting' ? (
        <p className="mt-4 flex items-center gap-3 text-sm text-zinc-400">
          <Spinner className="size-5 text-fuchsia-300" /> Connecting to Spotify…
        </p>
      ) : status === 'premium' ? (
        <Problem title="Playback needs Spotify Premium">
          Spotify only lets Premium accounts play full songs in the browser. Everyone can still search, add songs and vote.
        </Problem>
      ) : status === 'relogin' ? (
        <Problem title="Spotify session expired">
          <a href={spotifyLoginUrl(location.pathname)} className={`${buttonClass('secondary', 'sm')} mt-3`}>
            Log in with Spotify again
          </a>
        </Problem>
      ) : status === 'unsupported' ? (
        <Problem title="Can't start Spotify's player here">
          Spotify's web player needs a desktop browser like Chrome, Edge or Firefox. Search and voting still work.
        </Problem>
      ) : (
        <div className="mt-4">
          {elsewhere ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] p-3 text-sm ring-1 ring-white/10">
              <span className="text-zinc-300">Playback moved to another device.</span>
              <Button size="sm" variant="secondary" onClick={resumeHere}>
                Play here
              </Button>
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <button
              onClick={() => void player.current?.togglePlay()}
              disabled={!nowPlaying}
              aria-label={paused ? 'Play' : 'Pause'}
              className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-zinc-950 shadow-xl shadow-white/10 transition hover:scale-105 active:scale-95 disabled:opacity-30"
            >
              <Icon name={paused ? 'play' : 'pause'} className="size-6" strokeWidth={3} />
            </button>
            <button
              onClick={skip}
              disabled={!nowPlaying || next.isPending}
              aria-label="Skip to the next song"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-white/[0.07] text-zinc-200 ring-1 ring-white/10 transition hover:bg-white/[0.12] disabled:opacity-30"
            >
              {next.isPending ? <Spinner className="size-4" /> : <Icon name="skip" className="size-5" />}
            </button>
            <label className="ml-auto hidden items-center gap-2 text-zinc-400 sm:flex">
              <Icon name="volume" className="size-4" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                aria-label="Volume"
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setVolume(v)
                  void player.current?.setVolume(v)
                }}
                className="w-24 accent-fuchsia-400"
              />
            </label>
          </div>
          {!nowPlaying && !waiting ? <p className="mt-4 text-sm text-zinc-500">Ready. The first song added will start playing.</p> : null}
        </div>
      )}
    </Card>
  )
}

function StatusPill({ status }: { status: Status }) {
  if (status === 'ready') {
    return (
      <span className="flex items-center gap-2 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
        <Equalizer className="h-3" bars={3} /> Speaker on
      </span>
    )
  }
  if (status === 'idle' || status === 'connecting') return <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-zinc-400">Off</span>
  return <span className="rounded-full bg-rose-400/10 px-2.5 py-1 text-xs font-semibold text-rose-300">Unavailable</span>
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 rounded-2xl bg-rose-500/[0.08] p-4 ring-1 ring-rose-400/20">
      <p className="flex items-center gap-2 font-semibold text-rose-200">
        <Icon name="alert" className="size-4" /> {title}
      </p>
      <div className="mt-1.5 text-sm text-zinc-400">{children}</div>
    </div>
  )
}
