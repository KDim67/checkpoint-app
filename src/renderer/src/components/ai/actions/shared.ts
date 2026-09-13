import type { ColumnConfig } from '../../../lib/boardConfig'
import { asObject } from '../aiActionTypes'
import type { Item, Tag } from '@shared/types'

// dedupe DB calls and Strict Mode double-fires
export const executedActionSignaturesSet = new Set<string>()
export const createdItemsCacheMap = new Map<string, { item: Item; tags: Tag[] }>()
export const createdColsCacheMap = new Map<string, ColumnConfig>()
// what actually happened, so remounts replay the truth
export interface UpdateOutcome {
  applied: string[]
  notFound: string[]
  failed: string[]
  noops: number
  /** in application order, for undo */
  inverse?: Array<{ id: string; patch: Partial<Item> }>
  undone?: boolean
}
export const executedUpdateOutcomesMap = new Map<string, UpdateOutcome>()

// cleared on new chat
export function clearActionCaches() {
  executedActionSignaturesSet.clear()
  createdItemsCacheMap.clear()
  createdColsCacheMap.clear()
  executedUpdateOutcomesMap.clear()
}

/** catch binds unknown and IPC rejections aren't always Errors */
export function errorText(err: unknown): string {
  const message = asObject(err)?.message
  return typeof message === 'string' && message ? message : String(err)
}

// proposed columns before execution, written ones after
export type ShownColumn = { name: string; color?: string }
