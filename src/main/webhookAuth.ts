/** loopback isn't private, any page can post to 127.0.0.1; own module so auth is testable without the app */

import crypto from 'crypto'
import { getSetting, setSetting } from './db'

export const WEBHOOK_TOKEN_KEY = 'webhook_token'

/** short enough to paste, long enough to be hopeless */
const TOKEN_BYTES = 24
/** shorter wasn't generated here, don't trust it */
const MIN_TOKEN_LENGTH = 32

/** generated on first use */
export function ensureWebhookToken(): string {
  const existing = getSetting<string>(WEBHOOK_TOKEN_KEY, '')
  if (typeof existing === 'string' && existing.length >= MIN_TOKEN_LENGTH) return existing

  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  setSetting(WEBHOOK_TOKEN_KEY, token)
  return token
}

/** length first: timingSafeEqual throws, and a throw could stop the gateway */
export function tokenMatches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Bearer <token>, a bare token, or nothing */
export function offeredToken(header: string | undefined): string {
  if (typeof header !== 'string') return ''
  const trimmed = header.trim()
  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed)
  return (bearer ? bearer[1] : trimmed).trim()
}
