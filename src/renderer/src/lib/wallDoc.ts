/**
 * Reading and writing a workspace's walls.
 *
 * Mirrors `lib/boardConfig.ts`: the model is shared and pure, this half is the
 * IPC-backed load and save. Writes are debounced because dragging a sticky note
 * produces a position change on every animation frame, and persisting each one
 * would be thousands of database writes for a single gesture.
 *
 * Everything here takes a storage key rather than a workspace, because a
 * workspace now has several walls and the caller is the one that knows which.
 */

import {
  normalizeWallDoc, normalizeWallIndex, wallIndexKey,
  type WallDoc, type WallIndex
} from '../../../shared/wallModel'

/** Long enough to swallow a drag, short enough that a crash loses nothing worth having. */
const SAVE_DEBOUNCE_MS = 400

export async function loadWallDoc(key: string): Promise<WallDoc> {
  try {
    const stored = await window.electronAPI.db.getSetting(key)
    return normalizeWallDoc(stored)
  } catch (err) {
    // An unreadable wall yields an empty one rather than a broken view; the
    // stored value is left alone so nothing is destroyed by a bad read.
    console.error('[wall] could not load:', err)
    return normalizeWallDoc(null)
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Debounced per wall, so switching walls mid-drag cannot cross the writes. */
export function saveWallDoc(key: string, doc: WallDoc): void {
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)

  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      // Passed as an object: setSetting serialises once, and double-encoding is
      // the bug the board's own persistence layer had to be rescued from.
      window.electronAPI.db
        .setSetting(key, normalizeWallDoc(doc))
        .catch(err => console.error('[wall] could not save:', err))
    }, SAVE_DEBOUNCE_MS)
  )
}

/** Writes immediately, for when the view is going away and the timer would not fire. */
export async function flushWallDoc(key: string, doc: WallDoc): Promise<void> {
  const existing = timers.get(key)
  if (existing) {
    clearTimeout(existing)
    timers.delete(key)
  }
  try {
    await window.electronAPI.db.setSetting(key, normalizeWallDoc(doc))
  } catch (err) {
    console.error('[wall] could not flush:', err)
  }
}

/**
 * Drops a wall's document. The pending write is cancelled first, or a debounced
 * save from the last edit would land after the delete and resurrect it.
 */
export async function deleteWallDoc(key: string): Promise<void> {
  const existing = timers.get(key)
  if (existing) {
    clearTimeout(existing)
    timers.delete(key)
  }
  try {
    await window.electronAPI.db.deleteSetting(key)
  } catch (err) {
    console.error('[wall] could not delete:', err)
  }
}

export async function loadWallIndex(context: string): Promise<WallIndex> {
  try {
    return normalizeWallIndex(await window.electronAPI.db.getSetting(wallIndexKey(context)))
  } catch (err) {
    console.error('[wall] could not load index:', err)
    return normalizeWallIndex(null)
  }
}

/**
 * Written straight through rather than debounced: the index changes only when
 * a wall is created, renamed, deleted or switched to, and losing any of those
 * to a crash would strand a wall's contents.
 */
export async function saveWallIndex(context: string, index: WallIndex): Promise<void> {
  try {
    await window.electronAPI.db.setSetting(wallIndexKey(context), index)
  } catch (err) {
    console.error('[wall] could not save index:', err)
  }
}
