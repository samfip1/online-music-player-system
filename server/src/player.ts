import { Router } from 'express'
import { requireAuth } from './auth.js'
import { decrypt, encrypt } from './crypto.js'
import { db } from './db.js'
import { HttpError } from './errors.js'
import { refreshUserToken, SpotifyError } from './spotify.js'

// Gives the host's browser a short-lived Spotify access token for the Web Playback SDK.
// The refresh token never leaves the server.

// ponytail: in-memory per-user cache, lost on restart (the next call just refreshes again).
const tokens = new Map<string, { accessToken: string; expiresAt: number }>()

export const playerRouter = Router()

playerRouter.get('/player-token', requireAuth, async (req, res) => {
  const user = req.user!
  if (user.isGuest || !user.spotifyRefreshToken) throw new HttpError(403, 'Log in with Spotify to play music')

  const cached = tokens.get(user.id)
  if (cached && cached.expiresAt > Date.now()) return void res.json(cached)

  let fresh
  try {
    fresh = await refreshUserToken(decrypt(user.spotifyRefreshToken))
  } catch (err) {
    // 400 invalid_grant: the user revoked access or the token expired. They need to log in again.
    if (err instanceof SpotifyError && err.status === 400) {
      throw new HttpError(403, 'Your Spotify session expired. Log in with Spotify again.', { code: 'spotify_relogin' })
    }
    throw err
  }
  // Spotify sometimes rotates the refresh token; keep the newest one.
  if (fresh.refresh_token) {
    await db.user.update({ where: { id: user.id }, data: { spotifyRefreshToken: encrypt(fresh.refresh_token) } })
  }
  const token = { accessToken: fresh.access_token, expiresAt: Date.now() + (fresh.expires_in - 60) * 1000 }
  tokens.set(user.id, token)
  res.json(token)
})
