// model output arrives as unknown; narrow with these, a cast asserts a shape it never promised

import type { ItemPriority } from '@shared/types'
import type { ColumnConfig } from '@shared/boardModel'

/** mirrors normalizeBoardConfig: only 'full' is stored, everything else means header */
export function toColorMode(raw: unknown): ColumnConfig['colorMode'] {
  return raw === 'full' ? 'full' : 'header'
}

/** the only shape worth indexing */
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

/** the CHECK constraint rejects "3" or 5 and the whole card write fails */
export function toItemPriority(raw: unknown, fallback: ItemPriority = 2): ItemPriority {
  const n = Math.round(Number(raw))
  return n === 0 || n === 1 || n === 2 || n === 3 ? n : fallback
}

// bare strings or objects under several aliases; small models send every other shape too

/** '' when there isn't one */
export function tagNameOf(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  const o = asObject(raw)
  if (!o) return ''
  return str(o.name ?? o.label ?? o.tag).trim()
}

export function tagColorOf(raw: unknown, fallback: string): string {
  const o = asObject(raw)
  return o && o.color ? str(o.color) : fallback
}

/** tags stay raw until execution */
export interface ParsedCardJson {
  title: string
  body: string
  status: string
  priority: ItemPriority
  tags: unknown[]
}

export interface ParsedColumnJson {
  name: string
  wipLimit: number | null
  colorMode: string
  color: string
}

export interface BatchCard {
  title: string
  body: string
  status: string
  priority: ItemPriority
  tags: unknown[]
  due?: string
}

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

// shared by boardEnrich's normalizers and the executor

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
