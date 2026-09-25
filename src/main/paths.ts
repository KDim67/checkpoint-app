import { app } from 'electron'
import { join, resolve, relative, isAbsolute } from 'path'
import { existsSync, mkdirSync } from 'fs'

export function getCustomProfileName(): string | null {
  if (process.env.CHECKPOINT_PROFILE) {
    return process.env.CHECKPOINT_PROFILE
  }
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg.startsWith('--profile=')) {
      return arg.slice('--profile='.length)
    }
    if (arg === '--profile' && i + 1 < process.argv.length) {
      return process.argv[i + 1]
    }
  }
  return null
}

export function getCustomDataDir(): string | null {
  if (process.env.CHECKPOINT_DATA_DIR) {
    return resolve(process.env.CHECKPOINT_DATA_DIR)
  }
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg.startsWith('--data-dir=')) {
      return resolve(arg.slice('--data-dir='.length))
    }
    if (arg === '--data-dir' && i + 1 < process.argv.length) {
      return resolve(process.argv[i + 1])
    }
  }
  const profile = getCustomProfileName()
  if (profile) {
    const safeProfile = profile.replace(/[\\/:*?"<>|]/g, '_')
    return join(app.getPath('home'), '.config', `checkpoint-profile-${safeProfile}`)
  }
  return null
}

/** one source for paths; os.homedir() and app.getPath('home') disagree when electron's path is overridden */
export function getConfigDir(): string {
  const custom = getCustomDataDir()
  if (custom) {
    return join(custom, 'config')
  }
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
