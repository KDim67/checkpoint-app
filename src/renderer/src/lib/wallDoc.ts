/**
 * Reading and writing a workspace's Wall.
 *
 * Mirrors `lib/boardConfig.ts`: the model is shared and pure, this half is the
 * IPC-backed load and save. Writes are debounced because dragging a sticky note
 * produces a position change on every animation frame, and persisting each one
 * would be thousands of database writes for a single gesture.
 */

import { normalizeWallDoc, wallDocKey, type WallDoc } from '../../../shared/wallModel'

/** Long enough to swallow a drag, short enough that a crash loses nothing worth having. */
const SAVE_DEBOUNCE_MS = 400

export async function loadWallDoc(context: string): Promise<WallDoc> {
  try {
    const stored = await window.electronAPI.db.getSetting(wallDocKey(context))
    return normalizeWallDoc(stored)
  } catch (err) {
    // An unreadable wall yields an empty one rather than a broken view; the
    // stored value is left alone so nothing is destroyed by a bad read.
    console.error('[wall] could not load:', err)
    return normalizeWallDoc(null)
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Debounced per workspace, so switching walls mid-drag cannot cross the writes. */
export function saveWallDoc(context: string, doc: WallDoc): void {
  const existing = timers.get(context)
  if (existing) clearTimeout(existing)

  timers.set(
    context,
    setTimeout(() => {
      timers.delete(context)
      // Passed as an object: setSetting serialises once, and double-encoding is
      // the bug the board's own persistence layer had to be rescued from.
      window.electronAPI.db
        .setSetting(wallDocKey(context), normalizeWallDoc(doc))
        .catch(err => console.error('[wall] could not save:', err))
    }, SAVE_DEBOUNCE_MS)
  )
}

/** Writes immediately, for when the view is going away and the timer would not fire. */
export async function flushWallDoc(context: string, doc: WallDoc): Promise<void> {
  const existing = timers.get(context)
  if (existing) {
    clearTimeout(existing)
    timers.delete(context)
  }
  try {
    await window.electronAPI.db.setSetting(wallDocKey(context), normalizeWallDoc(doc))
  } catch (err) {
    console.error('[wall] could not flush:', err)
  }
}
