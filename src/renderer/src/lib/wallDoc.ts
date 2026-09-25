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

export const WALL_DOC_EVENT = 'wall-doc-written'
export const WALL_INDEX_EVENT = 'wall-index-written'

export interface WallDocWriteMeta {
  context?: string
  wallId?: string
  skipBroadcast?: boolean
}

export interface WallIndexWriteMeta {
  skipBroadcast?: boolean
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** per wall, so switching mid-drag can't cross writes */
export function saveWallDoc(key: string, doc: WallDoc, meta?: WallDocWriteMeta): void {
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)

  const normalized = normalizeWallDoc(doc)
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      // an object, setSetting serialises; double-encoding bit the board once
      setSetting(key, normalized)
        .then(() => {
          if (!meta?.skipBroadcast && meta?.context && meta?.wallId) {
            window.dispatchEvent(
              new CustomEvent(WALL_DOC_EVENT, { detail: { context: meta.context, wallId: meta.wallId, doc: normalized } })
            )
          }
        })
        .catch(err => console.error('[wall] could not save:', err))
    }, SAVE_DEBOUNCE_MS)
  )
}

/** immediate, for when the view is leaving */
export async function flushWallDoc(key: string, doc: WallDoc, meta?: WallDocWriteMeta): Promise<void> {
  const existing = timers.get(key)
  if (existing) {
    clearTimeout(existing)
    timers.delete(key)
  }
  const normalized = normalizeWallDoc(doc)
  try {
    await setSetting(key, normalized)
    if (!meta?.skipBroadcast && meta?.context && meta?.wallId) {
      window.dispatchEvent(
        new CustomEvent(WALL_DOC_EVENT, { detail: { context: meta.context, wallId: meta.wallId, doc: normalized } })
      )
    }
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
export async function saveWallIndex(context: string, index: WallIndex, meta?: WallIndexWriteMeta): Promise<void> {
  const normalized = normalizeWallIndex(index)
  try {
    await setSetting(wallIndexKey(context), normalized)
    if (!meta?.skipBroadcast) {
      window.dispatchEvent(
        new CustomEvent(WALL_INDEX_EVENT, { detail: { context, index: normalized } })
      )
    }
  } catch (err) {
    console.error('[wall] could not save index:', err)
  }
}
