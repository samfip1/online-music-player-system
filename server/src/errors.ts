import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { SpotifyError } from './spotify.js'

// Throw this from any route; the handler below turns it into { error, ...extra } with the status.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...err.extra })
  } else if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request', issues: err.issues })
  } else if (err instanceof SpotifyError) {
    console.error(err)
    res.status(502).json({ error: 'Spotify request failed' })
  } else {
    console.error(err)
    res.status(500).json({ error: 'Something went wrong' })
  }
}
