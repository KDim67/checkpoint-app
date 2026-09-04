import { app } from 'electron'
import { join, resolve, relative, isAbsolute } from 'path'
import { existsSync, mkdirSync } from 'fs'

/**
 * Single source of truth for on-disk locations. This used to be four copies,
 * two resolving the home directory via os.homedir() and two via
 * app.getPath('home'), which disagree whenever Electron's path is overridden.
 */
export function getConfigDir(): string {
  return join(app.getPath('home'), '.config', 'checkpoint')
}

export function getNotesDir(): string {
  return join(getConfigDir(), 'notes')
}

export function getMapsDir(): string {
  return join(getConfigDir(), 'maps')
}

export function getMediaDir(): string {
  return join(getConfigDir(), 'media')
}

/**
 * Derived files, safe to delete at any time: scaled copies of media images.
 * Kept out of the media folder so the orphan prune never reports them and the
 * user never mistakes one for something they added.
 */
export function getPreviewCacheDir(): string {
  return join(getConfigDir(), 'cache', 'previews')
}

export function getPluginsDir(): string {
  return join(getConfigDir(), 'plugins')
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Maps a user-supplied name to a file inside dir. Strips characters that are
 * illegal in filenames, then re-checks containment after resolution: sanitising
 * alone is not enough, because a name that survives the filter can still
 * traverse once the OS normalises it.
 */
export function resolveSafePath(dir: string, name: string, ext: string): string {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_')
  const resolvedPath = resolve(dir, `${safeName}${ext}`)
  const rel = relative(dir, resolvedPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path traversal detected')
  }
  return resolvedPath
}
