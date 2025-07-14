import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from './config.js'

// AES-256-GCM for Spotify refresh tokens at rest. Stored as "iv.authTag.ciphertext" (base64 parts).
const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex')

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}

export function decrypt(stored: string): string {
  const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
