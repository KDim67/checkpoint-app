/** pure, shared by renderer, AI blocks and MCP; one versioned doc per workspace in app_settings so it syncs */

export interface ColumnConfig {
  id: string
  name: string
  wipLimit: number | null
  color?: string
  colorMode?: 'header' | 'full'
  /** narrow strip with name and count */
  collapsed?: boolean
  /** 'manual' keeps drag order */
  sort?: ColumnSort
  /** definition of done, on hover */
  description?: string
}

export type ColumnSort = 'manual' | 'priority' | 'due'

/** hides without touching data; doneCheckbox's shortcut and modal still work */
export interface CardDisplay {
  priority: boolean
  tags: boolean
  due: boolean
  bodyPreview: boolean
  cover: boolean
  checklist: boolean
  template: boolean
  doneCheckbox: boolean
}

interface BoardFilters {
  query: string
  priority: number | null
  tagId: string | null
}

export interface BoardConfig {
  version: 1
  columns: ColumnConfig[]
  /** recoverable from the archive bin */
  archivedColumns: ColumnConfig[]
  /** as the picker writes it */
  background: string
  swimlanes: boolean
  cardDisplay: CardDisplay
  filters: BoardFilters
}

const CONFIG_VERSION = 1

export const DEFAULT_CARD_DISPLAY: CardDisplay = {
  priority: true,
  tags: true,
  due: true,
  bodyPreview: true,
  cover: true,
  checklist: true,
  template: true,
  doneCheckbox: true
}

/** memo comparators missed fields listed by hand; reading off the object catches new ones */
export function sameCardDisplay(a?: CardDisplay, b?: CardDisplay): boolean {
  const left = a ?? DEFAULT_CARD_DISPLAY
  const right = b ?? DEFAULT_CARD_DISPLAY
  return (Object.keys(DEFAULT_CARD_DISPLAY) as (keyof CardDisplay)[])
    .every(key => left[key] === right[key])
}

export function sameColumnConfig(a: ColumnConfig, b: ColumnConfig): boolean {
  if (a === b) return true

  // walked twice, a Set per column per render is real work; key counts miss undefined vs absent
  for (const key of Object.keys(a) as (keyof ColumnConfig)[]) {
    if (a[key] !== b[key]) return false
  }
  // leftover keys only if they say something
  for (const key of Object.keys(b) as (keyof ColumnConfig)[]) {
    if (a[key] === undefined && b[key] !== undefined) return false
  }
  return true
}

const DEFAULT_FILTERS: BoardFilters = {
  query: '',
  priority: null,
  tagId: null
}

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'open', name: 'To Do', wipLimit: null },
  { id: 'in_progress', name: 'In Progress', wipLimit: null },
  { id: 'in_review', name: 'In Review', wipLimit: null },
  { id: 'done', name: 'Done', wipLimit: null }
]


export const boardConfigKey = (context: string): string => `kanban_board_${context}`

/** pre-unification keys, exported for main's migration */
export const legacyColumnsKey = (context: string): string => `kanban_columns_${context}`
export const legacyBackgroundKey = (context: string): string => `kanban_bg_${context}`
export const legacyArchivedKey = (context: string): string => `kanban_archived_columns_${context}`
/** missed in the unification, which reset everyone's swimlanes */
export const legacySwimlanesKey = (context: string): string => `kanban_swimlanes_${context}`

/** the key bootstrap and AI blocks share; renderer and MCP must use the same one */
export const boardLockKey = (context: string): string => `kanban-cols:${context}`

// hand-written like boardEnrich's helpers, keeps Zod out of the renderer

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v)
}
function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

/** null means no limit, junk too */
function wip(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** missing or junk falls back to the default, never to false */
function normalizeCardDisplay(raw: Record<string, unknown>): CardDisplay {
  const display = { ...DEFAULT_CARD_DISPLAY }
  for (const key of Object.keys(DEFAULT_CARD_DISPLAY) as (keyof CardDisplay)[]) {
    display[key] = bool(raw[key], DEFAULT_CARD_DISPLAY[key])
  }
  return display
}

export function normalizeColumn(raw: unknown, index: number): ColumnConfig | null {
  const o = asObject(raw)
  if (!o) return null
  const name = str(o.name).trim()
  const id = str(o.id).trim() || name.toLowerCase().replace(/\s+/g, '_') || `col_${index}`
  if (!name) return null

  const column: ColumnConfig = { id, name, wipLimit: wip(o.wipLimit) }

  // defaults are omitted so equal docs serialise identically and undo compares whole
  if (typeof o.color === 'string' && o.color.trim()) column.color = o.color.trim()
  if (o.colorMode === 'full') column.colorMode = 'full'
  if (bool(o.collapsed, false)) column.collapsed = true
  if (o.sort === 'priority' || o.sort === 'due') column.sort = o.sort
  if (typeof o.description === 'string' && o.description.trim()) {
    column.description = o.description.trim()
  }
  return column
}

/** anything in, valid config out; runs every load, a bad row mustn't break the board */
export function normalizeBoardConfig(raw: unknown): BoardConfig {
  const o = asObject(raw)
  if (!o) {
    return {
      version: CONFIG_VERSION,
      columns: DEFAULT_COLUMNS.map(c => ({ ...c })),
      archivedColumns: [],
      background: 'default',
      swimlanes: false,
      cardDisplay: { ...DEFAULT_CARD_DISPLAY },
      filters: { ...DEFAULT_FILTERS }
    }
  }

  const columns = asArray(o.columns)
    .map((c, i) => normalizeColumn(c, i))
    .filter((c): c is ColumnConfig => c !== null)

  const archivedColumns = asArray(o.archivedColumns)
    .map((c, i) => normalizeColumn(c, i))
    .filter((c): c is ColumnConfig => c !== null)

  const display = asObject(o.cardDisplay) ?? {}
  const filters = asObject(o.filters) ?? {}
  const rawPriority = filters.priority
  const priorityNum =
    rawPriority === null || rawPriority === undefined ? null : Number(rawPriority)

  return {
    version: CONFIG_VERSION,
    // no columns would be an unusable board
    columns: columns.length > 0 ? columns : DEFAULT_COLUMNS.map(c => ({ ...c })),
    archivedColumns,
    background: str(o.background, 'default') || 'default',
    swimlanes: bool(o.swimlanes, false),
    // read off the defaults, a hand list dropped four toggles
    cardDisplay: normalizeCardDisplay(display),
    filters: {
      query: str(filters.query),
      priority: Number.isFinite(priorityNum) ? (priorityNum as number) : null,
      tagId: typeof filters.tagId === 'string' && filters.tagId ? filters.tagId : null
    }
  }
}

/** the legacy column key is double-encoded; strings and arrays both accepted */
function decodeLegacyList(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function migrateLegacy(
  rawColumns: unknown,
  rawBackground: unknown,
  rawArchived?: unknown,
  rawSwimlanes?: unknown
): BoardConfig {
  return normalizeBoardConfig({
    columns: decodeLegacyList(rawColumns),
    archivedColumns: decodeLegacyList(rawArchived),
    background: typeof rawBackground === 'string' && rawBackground ? rawBackground : 'default',
    // the old toggle stored 'true'/'false', bool() takes both
    swimlanes: rawSwimlanes ?? false,
    cardDisplay: DEFAULT_CARD_DISPLAY,
    filters: DEFAULT_FILTERS
  })
}


/** id first, then case-insensitive name */
export function findColumn(config: BoardConfig, target: string): ColumnConfig | undefined {
  const needle = target.trim().toLowerCase()
  return (
    config.columns.find(c => c.id.toLowerCase() === needle) ??
    config.columns.find(c => c.name.toLowerCase() === needle)
  )
}
