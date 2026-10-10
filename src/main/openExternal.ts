/** openExternal runs file:// and protocol handlers; links come from notes, cheatsheets and AI */

import { shell } from 'electron'

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Obsidian's open action naming a vault and a note, and nothing else: other actions, or a plugin's, can run commands */
export function isObsidianOpen(parsed: URL): boolean {
  if (parsed.protocol !== 'obsidian:' || parsed.hostname !== 'open') return false
  const keys = [...parsed.searchParams.keys()]
  return keys.length === 2 && keys.includes('vault') && keys.includes('file')
}

export function openExternalSafely(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    console.warn('[openExternal] Refusing to open unparseable URL:', url)
    return
  }
  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol) && !isObsidianOpen(parsed)) {
    console.warn('[openExternal] Refusing to open non-web URL:', parsed.protocol)
    return
  }
  shell.openExternal(parsed.href).catch(err => {
    console.error('Failed to open external URL:', err)
  })
}
