import { env } from './config.js'

// The only file that talks to Spotify's Web API (plus the host player in phase 8).
// Everything else works with the plain Track shape below.

const API = 'https://api.spotify.com/v1'
const ACCOUNTS = 'https://accounts.spotify.com'

export const USER_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
]

export class SpotifyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export type Track = {
  trackId: string
  trackUri: string
  title: string
  artists: string[]
  albumArtUrl: string | null
  durationMs: number
}

type SpotifyTrack = {
  id: string
  uri: string
  name: string
  duration_ms: number
  artists: { name: string }[]
  album: { images: { url: string; width: number | null }[] }
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string }

export type SpotifyProfile = {
  id: string
  display_name: string | null
  email?: string
  images?: { url: string }[]
}

function toTrack(t: SpotifyTrack): Track {
  // Images come largest first; the ~300px one is plenty for list rows and the now-playing card.
  const images = t.album.images
  return {
    trackId: t.id,
    trackUri: t.uri,
    title: t.name,
    artists: t.artists.map((a) => a.name),
    albumArtUrl: (images[1] ?? images[0])?.url ?? null,
    durationMs: t.duration_ms,
  }
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  })
  if (!res.ok) throw new SpotifyError(res.status, `Spotify token request failed (${res.status}): ${await res.text()}`)
  return (await res.json()) as TokenResponse
}

async function api<T>(path: string, token: string): Promise<T> {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new SpotifyError(res.status, `Spotify ${path.split('?')[0]} failed (${res.status})`)
  return (await res.json()) as T
}

// App-level (Client Credentials) token for search. Cached in memory, renewed a minute before expiry.
let appToken: { value: string; expiresAt: number } | null = null

async function getAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now()) return appToken.value
  const t = await tokenRequest({ grant_type: 'client_credentials' })
  appToken = { value: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 }
  return appToken.value
}

export async function searchTracks(q: string): Promise<Track[]> {
  // limit=10: development-mode apps may not be allowed more per request.
  const params = new URLSearchParams({ q, type: 'track', limit: '10' })
  const data = await api<{ tracks: { items: SpotifyTrack[] } }>(`/search?${params}`, await getAppToken())
  return data.tracks.items.map(toTrack)
}

/** Returns null when Spotify has no such track. */
export async function getTrack(trackId: string): Promise<Track | null> {
  try {
    return toTrack(await api<SpotifyTrack>(`/tracks/${trackId}`, await getAppToken()))
  } catch (err) {
    if (err instanceof SpotifyError && (err.status === 404 || err.status === 400)) return null
    throw err
  }
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.SPOTIFY_CLIENT_ID,
    scope: USER_SCOPES.join(' '),
    redirect_uri: env.SPOTIFY_REDIRECT_URI,
    state,
  })
  return `${ACCOUNTS}/authorize?${params}`
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: env.SPOTIFY_REDIRECT_URI })
}

export function refreshUserToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

export function getProfile(userAccessToken: string): Promise<SpotifyProfile> {
  return api<SpotifyProfile>('/me', userAccessToken)
}
