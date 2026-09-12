import type { ColumnConfig } from '../../../lib/boardConfig'
import { asObject } from '../aiActionTypes'
import type { Item, Tag } from '@shared/types'

// Global execution & caching locks. Prevent duplicate DB calls and React Strict Mode double-fires
export const executedActionSignaturesSet = new Set<string>()
export const createdItemsCacheMap = new Map<string, { item: Item; tags: Tag[] }>()
export const createdColsCacheMap = new Map<string, ColumnConfig>()
// Real outcome of each board-edit execution, so a remount replays the TRUTH
// (what was actually applied / skipped / not found) instead of the request.
export interface UpdateOutcome {
  applied: string[]
  notFound: string[]
  failed: string[]
  noops: number
  /** Inverse patches (in application order) enabling one-click undo. */
  inverse?: Array<{ id: string; patch: Partial<Item> }>
  undone?: boolean
}
export const executedUpdateOutcomesMap = new Map<string, UpdateOutcome>()

// Exported so AiStreamPanel can clear caches on new chat
export function clearActionCaches() {
  executedActionSignaturesSet.clear()
  createdItemsCacheMap.clear()
  createdColsCacheMap.clear()
  executedUpdateOutcomesMap.clear()
}

/** Message text from a thrown value: `catch` binds `unknown`, and an IPC
 *  rejection is not always an Error. */
export function errorText(err: unknown): string {
  const message = asObject(err)?.message
  return typeof message === 'string' && message ? message : String(err)
}

// The confirmation row shows either the PROPOSED columns (before execution) or
// the ones actually written to the setting. This is the overlap it renders.
export type ShownColumn = { name: string; color?: string }
