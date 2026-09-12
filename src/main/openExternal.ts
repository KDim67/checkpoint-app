/**
 * shell.openExternal hands the URL to the OS, which will happily run a
 * file:// path or a registered protocol handler. Links reach us from note
 * markdown, cheatsheets and AI responses, so the scheme is checked before
 * anything leaves the app.
 */

import { shell } from 'electron'

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function openExternalSafely(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    console.warn('[openExternal] Refusing to open unparseable URL:', url)
    return
  }
  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    console.warn('[openExternal] Refusing to open non-web URL:', parsed.protocol)
    return
  }
  shell.openExternal(parsed.href).catch(err => {
    console.error('Failed to open external URL:', err)
  })
}
