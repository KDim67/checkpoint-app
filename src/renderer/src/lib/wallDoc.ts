/** mirrors lib/boardConfig; writes debounced since drags change every frame; keyed per wall */

import {
  normalizeWallDoc, normalizeWallIndex, wallIndexKey,
  type WallDoc, type WallIndex
} from '../../../shared/wallModel'
import { deleteSetting, getSetting, setSetting } from '../data/settings'

/** swallows a drag, a crash loses little */
const SAVE_DEBOUNCE_MS = 400

export async function loadWallDoc(key: string): Promise<WallDoc> {
  try {
    const stored = await getSetting(key)
    return normalizeWallDoc(stored)
  } catch (err) {
    // an empty wall beats a broken view, the stored value is untouched
    console.error('[wall] could not load:', err)
    return normalizeWallDoc(null)
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** per wall, so switching mid-drag can't cross writes */
export function saveWallDoc(key: string, doc: WallDoc): void {
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)

  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      // an object, setSetting serialises; double-encoding bit the board once
      setSetting(key, normalizeWallDoc(doc))
        .catch(err => console.error('[wall] could not save:', err))
    }, SAVE_DEBOUNCE_MS)
  )
}

/** immediate, for when the view is leaving */
export async function flushWallDoc(key: string, doc: WallDoc): Promise<void> {
  const existing = timers.get(key)
  if (existing) {
    clearTimeout(existing)
    timers.delete(key)
  }
  try {
    await setSetting(key, normalizeWallDoc(doc))
  } catch (err) {
    console.error('[wall] could not flush:', err)
  }
}

/** cancel the pending write or it resurrects the wall */
export async function deleteWallDoc(key: string): Promise<void> {
  const existing = timers.get(key)
  if (existing) {
    clearTimeout(existing)
    timers.delete(key)
  }
  try {
    await deleteSetting(key)
  } catch (err) {
    console.error('[wall] could not delete:', err)
  }
}

export async function loadWallIndex(context: string): Promise<WallIndex> {
  try {
    return normalizeWallIndex(await getSetting(wallIndexKey(context)))
  } catch (err) {
    console.error('[wall] could not load index:', err)
    return normalizeWallIndex(null)
  }
}

/** not debounced, losing one of these strands a wall */
export async function saveWallIndex(context: string, index: WallIndex): Promise<void> {
  try {
    await setSetting(wallIndexKey(context), index)
  } catch (err) {
    console.error('[wall] could not save index:', err)
  }
}
