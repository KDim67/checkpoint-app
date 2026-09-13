/** everything the config UI can do; each op computes its inverse; pure, card moves come back as instructions */

import {
  normalizeBoardConfig,
  findColumn,
  DEFAULT_CARD_DISPLAY,
  type BoardConfig,
  type CardDisplay,
  type ColumnConfig,
  type ColumnSort
} from './boardModel'

type ConfigOp =
  | 'add_column'
  | 'update_column'
  | 'delete_column'
  | 'reorder_columns'
  | 'set_background'
  | 'set_swimlanes'
  | 'set_card_display'

export interface ConfigOperation {
  op: ConfigOp
  /** column id or name */
  target?: string
  /** original id for an inverse, moved cards still carry it */
  id?: string
  name?: string
  wipLimit?: number | null
  color?: string
  colorMode?: 'header' | 'full'
  collapsed?: boolean
  sort?: ColumnSort
  description?: string
  /** insertion index, also for a delete's inverse */
  position?: number
  /** ids or names, in order */
  order?: string[]
  background?: string
  swimlanes?: boolean
  cardDisplay?: Partial<CardDisplay>
  /** set by the caller when undoing a delete */
  restoreCards?: { id: string; status: string }[]
}

interface ApplyResult {
  next: BoardConfig
  /** returns the board to before */
  inverse: ConfigOperation[]
  /** one line per applied op */
  summary: string[]
  /** what couldn't be done */
  skipped: string[]
  /** cards follow to the first surviving column, like the board's own delete */
  cardMoves: { fromColumn: string; toColumn: string }[]
}

const VALID_OPS: ConfigOp[] = [
  'add_column', 'update_column', 'delete_column', 'reorder_columns',
  'set_background', 'set_swimlanes', 'set_card_display'
]

const COLUMN_SORTS: ColumnSort[] = ['manual', 'priority', 'due']

// small models vary key names; accept synonyms, drop the unrecognisable

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v)
}
function boolOrUndef(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}
function wipOrUndef(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '' || v === 'none' || v === 'null') return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** #rrggbb, bare rrggbb, or CSS colour names */
const NAMED_COLORS: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4',
  blue: '#3b82f6', indigo: '#6366f1', purple: '#a855f7', pink: '#ec4899',
  grey: '#64748b', gray: '#64748b', slate: '#64748b'
}

function colorOrUndef(v: unknown): string | undefined {
  const raw = str(v).trim().toLowerCase()
  if (!raw) return undefined
  if (NAMED_COLORS[raw]) return NAMED_COLORS[raw]
  const hex = raw.startsWith('#') ? raw : `#${raw}`
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : undefined
}

export function normalizeConfigUpdate(
  raw: unknown
): { message: string; operations: ConfigOperation[] } | null {
  const obj = asObject(raw)
  if (!obj) return null

  const operations: ConfigOperation[] = []
  for (const entry of asArray(obj.operations ?? obj.ops ?? obj.changes ?? obj.edits)) {
    const e = asObject(entry)
    if (!e) continue

    const op = str(e.op || e.action || e.type)
      .trim().toLowerCase().replace(/[\s-]+/g, '_') as ConfigOp
    if (!VALID_OPS.includes(op)) continue

    const target = str(e.target ?? e.column ?? e.columnName ?? e.column_name ?? e.name).trim()
    const next: ConfigOperation = { op }

    if (op === 'add_column') {
      const name = str(e.name ?? e.title ?? e.target).trim()
      if (!name) continue
      next.name = name
    } else if (op === 'update_column' || op === 'delete_column') {
      if (!target) continue
      next.target = target
      // name renames on update but identifies on add
      if (op === 'update_column' && e.name !== undefined && str(e.name).trim() && str(e.name).trim() !== target) {
        next.name = str(e.name).trim()
      }
    } else if (op === 'reorder_columns') {
      const order = asArray(e.order ?? e.columns ?? e.sequence).map(x => str(x).trim()).filter(Boolean)
      if (order.length === 0) continue
      next.order = order
    } else if (op === 'set_background') {
      const bg = str(e.background ?? e.value ?? e.color ?? e.preset).trim()
      if (!bg) continue
      next.background = colorOrUndef(bg) ?? bg
    } else if (op === 'set_swimlanes') {
      const on = boolOrUndef(e.swimlanes ?? e.enabled ?? e.value)
      if (on === undefined) continue
      next.swimlanes = on
    } else if (op === 'set_card_display') {
      const d = asObject(e.cardDisplay ?? e.display ?? e.fields ?? e.value)
      if (!d) continue
      const partial: Partial<CardDisplay> = {}
      for (const key of Object.keys(DEFAULT_CARD_DISPLAY) as (keyof CardDisplay)[]) {
        const val = boolOrUndef(d[key])
        if (val !== undefined) partial[key] = val
      }
      if (Object.keys(partial).length === 0) continue
      next.cardDisplay = partial
    }

    // add_column and update_column only
    if (op === 'add_column' || op === 'update_column') {
      const wip = wipOrUndef(e.wipLimit ?? e.wip_limit ?? e.wip ?? e.limit)
      if (wip !== undefined) next.wipLimit = wip
      const color = colorOrUndef(e.color ?? e.colour)
      if (color) next.color = color
      const mode = str(e.colorMode ?? e.color_mode).trim().toLowerCase()
      if (mode === 'full' || mode === 'header') next.colorMode = mode
      const collapsed = boolOrUndef(e.collapsed)
      if (collapsed !== undefined) next.collapsed = collapsed
      const sort = str(e.sort ?? e.order_by ?? e.sortBy).trim().toLowerCase()
      if (COLUMN_SORTS.includes(sort as ColumnSort)) next.sort = sort as ColumnSort
      const description = str(e.description ?? e.definitionOfDone ?? e.definition_of_done ?? e.policy).trim()
      if (description) next.description = description
      const pos = e.position ?? e.index
      if (pos !== undefined) {
        const n = typeof pos === 'number' ? pos : parseInt(String(pos), 10)
        if (Number.isFinite(n) && n >= 0) next.position = n
      }
    }

    operations.push(next)
  }

  if (operations.length === 0) return null
  return { message: str(obj.message).trim(), operations }
}

function columnId(name: string): string {
  return `col-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

/** every field explicit: undefined means leave alone, so an inverse couldn't remove an added colour */
function captureColumn(col: ColumnConfig): ConfigOperation {
  return {
    op: 'update_column',
    target: col.id,
    name: col.name,
    wipLimit: col.wipLimit,
    color: col.color ?? '',
    colorMode: col.colorMode ?? 'header',
    collapsed: col.collapsed ?? false,
    sort: col.sort ?? 'manual',
    description: col.description ?? ''
  }
}

/** never mutates the input */
export function applyConfigOps(config: BoardConfig, operations: ConfigOperation[]): ApplyResult {
  let next = normalizeBoardConfig(config)
  const inverse: ConfigOperation[] = []
  const summary: string[] = []
  const skipped: string[] = []
  const cardMoves: { fromColumn: string; toColumn: string }[] = []

  for (const operation of operations) {
    switch (operation.op) {
      case 'add_column': {
        const name = operation.name ?? ''
        if (findColumn(next, name)) {
          skipped.push(`Column "${name}" already exists`)
          break
        }
        const col: ColumnConfig = {
          id: operation.id ?? columnId(name),
          name,
          wipLimit: operation.wipLimit ?? null
        }
        if (operation.color) col.color = operation.color
        if (operation.colorMode) col.colorMode = operation.colorMode
        if (operation.sort) col.sort = operation.sort
        if (operation.description) col.description = operation.description

        const columns = [...next.columns]
        const at = operation.position !== undefined
          ? Math.min(operation.position, columns.length)
          : columns.length
        columns.splice(at, 0, col)
        next = { ...next, columns }
        // unshift, inverses run newest-first
        inverse.unshift({ op: 'delete_column', target: col.id })
        summary.push(`Added column "${name}"`)
        break
      }

      case 'update_column': {
        const col = findColumn(next, operation.target ?? '')
        if (!col) {
          skipped.push(`No column matching "${operation.target}"`)
          break
        }
        const updated: ColumnConfig = { ...col }
        const changes: string[] = []
        if (operation.name !== undefined) { updated.name = operation.name; changes.push(`renamed to "${operation.name}"`) }
        if (operation.wipLimit !== undefined) {
          updated.wipLimit = operation.wipLimit
          changes.push(operation.wipLimit === null ? 'WIP limit removed' : `WIP limit ${operation.wipLimit}`)
        }
        // '' clears, undefined leaves alone, so undo can remove a colour
        if (operation.color !== undefined) {
          updated.color = operation.color || undefined
          changes.push(operation.color ? `colour ${operation.color}` : 'colour cleared')
        }
        if (operation.colorMode !== undefined) { updated.colorMode = operation.colorMode }
        if (operation.collapsed !== undefined) {
          updated.collapsed = operation.collapsed
          changes.push(operation.collapsed ? 'collapsed' : 'expanded')
        }
        if (operation.sort !== undefined) { updated.sort = operation.sort; changes.push(`ordered by ${operation.sort}`) }
        if (operation.description !== undefined) {
          updated.description = operation.description || undefined
          changes.push('definition of done set')
        }
        if (changes.length === 0) {
          skipped.push(`Nothing to change on "${col.name}"`)
          break
        }
        inverse.unshift(captureColumn(col))
        next = { ...next, columns: next.columns.map(c => (c.id === col.id ? updated : c)) }
        summary.push(`${col.name}: ${changes.join(', ')}`)
        break
      }

      case 'delete_column': {
        const col = findColumn(next, operation.target ?? '')
        if (!col) {
          skipped.push(`No column matching "${operation.target}"`)
          break
        }
        if (next.columns.length <= 1) {
          skipped.push(`Cannot delete "${col.name}": a board needs at least one column`)
          break
        }
        const at = next.columns.findIndex(c => c.id === col.id)
        const remaining = next.columns.filter(c => c.id !== col.id)
        // cards follow to the first surviving column
        cardMoves.push({ fromColumn: col.id, toColumn: remaining[0].id })
        next = { ...next, columns: remaining }
        inverse.unshift({
          op: 'add_column',
          id: col.id,
          name: col.name,
          wipLimit: col.wipLimit,
          color: col.color,
          colorMode: col.colorMode,
          sort: col.sort,
          description: col.description,
          position: at
        })
        summary.push(`Deleted column "${col.name}" (cards moved to "${remaining[0].name}")`)
        break
      }

      case 'reorder_columns': {
        const requested = operation.order ?? []
        const resolved: ColumnConfig[] = []
        for (const ref of requested) {
          const col = findColumn(next, ref)
          if (col && !resolved.some(c => c.id === col.id)) resolved.push(col)
        }
        if (resolved.length === 0) {
          skipped.push('None of the columns in the requested order were recognised')
          break
        }
        // unlisted columns keep their order at the end
        const rest = next.columns.filter(c => !resolved.some(r => r.id === c.id))
        inverse.unshift({ op: 'reorder_columns', order: next.columns.map(c => c.id) })
        next = { ...next, columns: [...resolved, ...rest] }
        summary.push(`Reordered columns: ${[...resolved, ...rest].map(c => c.name).join(' → ')}`)
        break
      }

      case 'set_background': {
        const bg = operation.background ?? ''
        if (bg === next.background) { skipped.push('Background already set to that value'); break }
        inverse.unshift({ op: 'set_background', background: next.background })
        next = { ...next, background: bg }
        summary.push(`Board background set to ${bg}`)
        break
      }

      case 'set_swimlanes': {
        const on = operation.swimlanes ?? false
        if (on === next.swimlanes) { skipped.push(`Swimlanes already ${on ? 'on' : 'off'}`); break }
        inverse.unshift({ op: 'set_swimlanes', swimlanes: next.swimlanes })
        next = { ...next, swimlanes: on }
        summary.push(`Priority swimlanes ${on ? 'enabled' : 'disabled'}`)
        break
      }

      case 'set_card_display': {
        const patch = operation.cardDisplay ?? {}
        const changedKeys = (Object.keys(patch) as (keyof CardDisplay)[])
          .filter(k => patch[k] !== next.cardDisplay[k])
        if (changedKeys.length === 0) { skipped.push('Card fields already in that state'); break }
        inverse.unshift({ op: 'set_card_display', cardDisplay: { ...next.cardDisplay } })
        next = { ...next, cardDisplay: { ...next.cardDisplay, ...patch } }
        summary.push(
          changedKeys.map(k => `${patch[k] ? 'show' : 'hide'} ${k}`).join(', ')
        )
        break
      }
    }
  }

  return { next: normalizeBoardConfig(next), inverse, summary, skipped, cardMoves }
}
