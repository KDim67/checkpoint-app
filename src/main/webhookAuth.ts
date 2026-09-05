/**
 * The webhook gateway's shared secret.
 *
 * Its own module rather than part of the gateway, because the gateway reaches
 * into the app's entry point for the main window, and nothing that decides who
 * is allowed to write to the database should need the whole app loaded to be
 * exercised.
 *
 * Why a secret exists at all: the gateway is an HTTP server on the loopback
 * interface, and loopback is not private. Any page in any browser the user has
 * open can post to 127.0.0.1. Without a token, and with the wildcard CORS
 * header the gateway used to send, any website could silently create rows in
 * the user's database. The gateway is on by default, so that was every install.
 */

import crypto from 'crypto'
import { getSetting, setSetting } from './db'

export const WEBHOOK_TOKEN_KEY = 'webhook_token'

/** 24 random bytes as hex. Short enough to paste, long enough to be hopeless. */
const TOKEN_BYTES = 24
/** Anything shorter than this was not generated here and is not trusted. */
const MIN_TOKEN_LENGTH = 32

/** The stored token, generated on first use and kept afterwards. */
export function ensureWebhookToken(): string {
  const existing = getSetting<string>(WEBHOOK_TOKEN_KEY, '')
  if (typeof existing === 'string' && existing.length >= MIN_TOKEN_LENGTH) return existing

  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  setSetting(WEBHOOK_TOKEN_KEY, token)
  return token
}

/**
 * Compares tokens without leaking how much of one was right.
 *
 * The length is checked first because `timingSafeEqual` throws on a mismatch,
 * and a throw inside the request handler would be a way to stop the gateway
 * by sending it a short string.
 */
export function tokenMatches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Reads `Authorization: Bearer <token>`, or a bare token, or nothing. */
export function offeredToken(header: string | undefined): string {
  if (typeof header !== 'string') return ''
  const trimmed = header.trim()
  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed)
  return (bearer ? bearer[1] : trimmed).trim()
}
