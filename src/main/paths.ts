import { app } from 'electron'
import { join, resolve, relative, isAbsolute } from 'path'
import { existsSync, mkdirSync } from 'fs'

/** one source for paths; os.homedir() and app.getPath('home') disagree when electron's path is overridden */
export function getConfigDir(): string {
  return join(app.getPath('home'), '.config', 'checkpoint')
}

export function getNotesDir(): string {
  return join(getConfigDir(), 'notes')
}

export function getMediaDir(): string {
  return join(getConfigDir(), 'media')
}

/** derived and deletable; outside media so the orphan prune ignores them */
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

/** re-check containment after resolving, a sanitised name can still traverse once normalised */
export function resolveSafePath(dir: string, name: string, ext: string): string {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_')
  const resolvedPath = resolve(dir, `${safeName}${ext}`)
  const rel = relative(dir, resolvedPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path traversal detected')
  }
  return resolvedPath
}
