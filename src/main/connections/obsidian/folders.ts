/** which folder each workspace follows; kept on this computer only, since a folder's path is this computer's own */

import { resolve } from 'path'
import { getDb, getSetting, readContextList, setSetting } from '../../db'

export const OBSIDIAN_FOLDERS_KEY = 'obsidian_folders'

export function readFolderChoices(): Record<string, string> {
  const raw = getSetting<unknown>(OBSIDIAN_FOLDERS_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0))
}

export function setFolderChoice(slug: string, folder: string | null): void {
  const next = readFolderChoices()
  if (folder === null) delete next[slug]
  else next[slug] = resolve(folder)
  setSetting(OBSIDIAN_FOLDERS_KEY, next)
}

/** folder to workspace; a folder two workspaces pick fills the first */
export function followedFolders(): Map<string, string> {
  const choices = readFolderChoices()
  const out = new Map<string, string>()
  for (const entry of readContextList(getDb()) ?? []) {
    const folder = choices[entry.slug]
    if (folder && !out.has(folder)) out.set(folder, entry.slug)
  }
  return out
}
