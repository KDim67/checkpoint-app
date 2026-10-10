/** a followed folder's notes on disk: listed without leaving the folder, read, and written whole in one step only when nothing changed them since */

import { lstat, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { existsSync } from 'fs'
import { isSkippedPath } from '../../../shared/obsidianImport'

/** a vault is notes, not a whole home directory */
const MAX_FILES = 20_000
/** bigger than any note a person writes; a log or an export is left alone */
export const MAX_NOTE_BYTES = 2 * 1024 * 1024

export interface NoteFile {
  path: string
  mtime: number
  size: number
}

/** true when path is root itself or somewhere under it */
export function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel))
}

/** every note under root; links are never followed, so nothing outside it is reached */
export async function listNotes(root: string): Promise<NoteFile[]> {
  const found: NoteFile[] = []
  const visit = async (dir: string): Promise<void> => {
    if (found.length >= MAX_FILES) return
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return
      const full = join(dir, entry)
      if (isSkippedPath(relative(root, full))) continue
      let info: Awaited<ReturnType<typeof lstat>>
      try {
        info = await lstat(full)
      } catch {
        continue
      }
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) await visit(full)
      else if (info.isFile() && entry.toLowerCase().endsWith('.md') && info.size <= MAX_NOTE_BYTES) {
        found.push({ path: full, mtime: info.mtimeMs, size: info.size })
      }
    }
  }
  await visit(root)
  return found
}

export const readNote = (path: string): Promise<string> => readFile(path, 'utf8')

export type WriteOutcome = 'written' | 'changed'

/** the whole note in one step, through a file beside it renamed over it; refused when it changed since it was read at that time */
export async function writeNote(root: string, path: string, text: string, readAt: number): Promise<WriteOutcome> {
  if (!isInside(root, path)) throw Object.assign(new Error('That note is outside the folder Checkpoint follows.'), { code: 'EOUTSIDE' })
  const now = await stat(path)
  if (now.mtimeMs !== readAt) return 'changed'
  const temporary = join(dirname(path), `.${basename(path)}.checkpoint`)
  await writeFile(temporary, text, 'utf8')
  try {
    await rename(temporary, path)
  } catch (err) {
    await unlink(temporary).catch(() => {})
    throw err
  }
  return 'written'
}

/** the vault a folder is in: the nearest folder up that Obsidian keeps its settings in, else the folder itself */
export function vaultOf(folder: string): { root: string; name: string } {
  let at = resolve(folder)
  for (;;) {
    if (existsSync(join(at, '.obsidian'))) return { root: at, name: basename(at) }
    const up = dirname(at)
    if (up === at) return { root: resolve(folder), name: basename(resolve(folder)) }
    at = up
  }
}
