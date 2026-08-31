// Types for the model-output boundary that the chat action blocks execute.
//
// Everything the AI emits arrives as untyped JSON, so the honest shape at the
// edge is `unknown`. These narrowing helpers are the ONLY sanctioned way to
// reach into it, a cast would assert a shape the model never promised, and
// this code writes straight to the user's database.
//
// The interfaces below describe what a normalizer PRODUCES, not what the model
// sent. Once a value has been through one it is concrete, and every call site
// downstream is typed for free.

import type { ItemPriority } from '@shared/types'

/** A JSON object after narrowing, the only shape worth indexing into. */
export type JsonObject = Record<string, unknown>

export function asObject(v: unknown): JsonObject | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : null
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v)
}

/**
 * A priority the database will actually accept.
 *
 * `items.priority` is `CHECK(priority IN (0,1,2,3))` and the IPC schema matches
 * it with bare literals, no coercion. So the `"3"` a small model routinely
 * emits, or a made-up `5`, does not degrade: it rejects the entire card write.
 * Anything unusable falls back to the same default the callers already used.
 */
export function toItemPriority(raw: unknown, fallback: ItemPriority = 2): ItemPriority {
  const n = Math.round(Number(raw))
  return n === 0 || n === 1 || n === 2 || n === 3 ? n : fallback
}

// Tags as the model writes them
// A tag arrives as a bare string, or as an object under any of several aliases.
// Both readers tolerate every other shape (numbers, null, arrays) because small
// models produce all of them.

/** Tag name from a raw model tag entry; '' when there isn't one. */
export function tagNameOf(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  const o = asObject(raw)
  if (!o) return ''
  return str(o.name ?? o.label ?? o.tag).trim()
}

/** Tag colour from a raw model tag entry, falling back when absent. */
export function tagColorOf(raw: unknown, fallback: string): string {
  const o = asObject(raw)
  return o && o.color ? str(o.color) : fallback
}

// Persisted board configuration

/** Shape of the `kanban_columns_<context>` setting. */
export interface KanbanColumnConfig {
  id: string
  name: string
  wipLimit?: number | null
  color?: string
  colorMode?: string
}

/**
 * Read a columns setting. It is normally a JSON string, but older writes stored
 * the array directly, so both are accepted and anything else yields an empty
 * list. The parsed value is trusted as our own persisted schema, this is the
 * single deserialization boundary for it.
 */
export function readColumnsSetting(raw: unknown): KanbanColumnConfig[] {
  let parsed = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return [] }
  }
  return Array.isArray(parsed) ? parsed : []
}

// Normalizer outputs

/** A single card block after `normalizeCardJson`. Tags stay raw, they are only
 *  resolved against the tag table at execution time. */
export interface ParsedCardJson {
  title: string
  body: string
  status: string
  priority: ItemPriority
  tags: unknown[]
}

/** A single column block after `normalizeColumnJson`. */
export interface ParsedColumnJson {
  name: string
  wipLimit: number | null
  colorMode: string
  color: string
}

/** A card inside a batch board block. */
export interface BatchCard {
  title: string
  body: string
  status: string
  priority: ItemPriority
  tags: unknown[]
  due?: string
}

/** A column inside a batch board block. */
export interface BatchColumn {
  name: string
  wipLimit: number | null
  colorMode: string
  color: string
}

export interface BatchBoard {
  columns: BatchColumn[]
  cards: BatchCard[]
}

// Plan / dialogue blocks
// Produced by boardEnrich's normalizers and re-parsed from the fenced block by
// the executor, so both ends share these shapes.

export interface AiPlanStep {
  title: string
  details: string
  status: string
}

export interface AiPlanBlock {
  title: string
  overview: string
  steps: AiPlanStep[]
}

export interface AiDialogueChoice {
  text: string
  target: string
}

export interface AiDialogueNode {
  id: string
  speaker: string
  text: string
  choices: AiDialogueChoice[]
}

export interface AiDialogueBlock {
  startNode: string
  nodes: AiDialogueNode[]
}
