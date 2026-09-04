/**
 * The Kanban board configuration model. Pure: no I/O, no `window`, no database.
 *
 * In `shared/` because the renderer, the AI action blocks and the MCP server
 * all need it and main cannot import from the renderer.
 *
 * One versioned document per workspace, stored in `app_settings`, so it syncs
 * between machines with no extra plumbing.
 */

export interface ColumnConfig {
  id: string
  name: string
  wipLimit: number | null
  color?: string
  colorMode?: 'header' | 'full'
  /** Collapsed to a narrow strip showing only the name and card count. */
  collapsed?: boolean
  /** Ordering within the column. 'manual' preserves drag order. */
  sort?: ColumnSort
  /** Short policy note. A definition of done, surfaced on hover. */
  description?: string
}

export type ColumnSort = 'manual' | 'priority' | 'due'

export interface CardDisplay {
  priority: boolean
  tags: boolean
  due: boolean
  bodyPreview: boolean
}

export interface BoardFilters {
  query: string
  priority: number | null
  tagId: string | null
}

export interface BoardConfig {
  version: 1
  columns: ColumnConfig[]
  /** Columns removed from the board but recoverable from the archive bin. */
  archivedColumns: ColumnConfig[]
  /** Preset id, hex colour, CSS gradient, or image url. As the picker writes it. */
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
  bodyPreview: true
}

export const DEFAULT_FILTERS: BoardFilters = {
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


// Storage keys

export const boardConfigKey = (context: string): string => `kanban_board_${context}`

/** Pre-unification keys. Exported so main can run the same migration. */
export const legacyColumnsKey = (context: string): string => `kanban_columns_${context}`
export const legacyBackgroundKey = (context: string): string => `kanban_bg_${context}`
export const legacyArchivedKey = (context: string): string => `kanban_archived_columns_${context}`
/**
 * The fourth legacy key. It was missed when board configuration was unified:
 * migrateLegacy hardcoded `swimlanes: false`, so anyone with priority
 * swimlanes enabled had the preference silently reset on their first load
 * after that change, with the old row left orphaned in the settings table.
 */
export const legacySwimlanesKey = (context: string): string => `kanban_swimlanes_${context}`

/**
 * Every mutation serialises on the key the board bootstrap and the AI action
 * blocks already share. Config writes are read-modify-write, which is exactly
 * the sequence that produced duplicate columns when two of them interleaved.
 * Exported because the renderer's persistence layer and the MCP server must
 * take the same lock name to serialise against each other.
 */
export const boardLockKey = (context: string): string => `kanban-cols:${context}`

// Normalisation
// Hand-written rather than schema-driven, matching the asObject/asArray/str
// helpers in boardEnrich.ts and keeping Zod out of the renderer bundle.

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

/** null means "no limit"; anything unparseable degrades to no limit. */
function wip(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function normalizeColumn(raw: unknown, index: number): ColumnConfig | null {
  const o = asObject(raw)
  if (!o) return null
  const name = str(o.name).trim()
  const id = str(o.id).trim() || name.toLowerCase().replace(/\s+/g, '_') || `col_${index}`
  if (!name) return null

  const column: ColumnConfig = { id, name, wipLimit: wip(o.wipLimit) }

  // Canonical form: a field equal to its default is omitted rather than stored.
  // Two documents that mean the same thing then serialise identically, which is
  // what lets an undo be checked by comparing against the original instead of
  // field by field, and stops "collapsed: false" being written where the key
  // simply never existed.
  if (typeof o.color === 'string' && o.color.trim()) column.color = o.color.trim()
  if (o.colorMode === 'full') column.colorMode = 'full'
  if (bool(o.collapsed, false)) column.collapsed = true
  if (o.sort === 'priority' || o.sort === 'due') column.sort = o.sort
  if (typeof o.description === 'string' && o.description.trim()) {
    column.description = o.description.trim()
  }
  return column
}

/**
 * Produces a valid config from anything. A partial, stale or corrupted document
 * degrades to defaults rather than throwing. This runs on every board load, and
 * a bad settings row must not be able to take the board down.
 */
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
    // An empty column list would render an unusable board with no way back, so
    // it falls back rather than persisting the emptiness.
    columns: columns.length > 0 ? columns : DEFAULT_COLUMNS.map(c => ({ ...c })),
    archivedColumns,
    background: str(o.background, 'default') || 'default',
    swimlanes: bool(o.swimlanes, false),
    cardDisplay: {
      priority: bool(display.priority, DEFAULT_CARD_DISPLAY.priority),
      tags: bool(display.tags, DEFAULT_CARD_DISPLAY.tags),
      due: bool(display.due, DEFAULT_CARD_DISPLAY.due),
      bodyPreview: bool(display.bodyPreview, DEFAULT_CARD_DISPLAY.bodyPreview)
    },
    filters: {
      query: str(filters.query),
      priority: Number.isFinite(priorityNum) ? (priorityNum as number) : null,
      tagId: typeof filters.tagId === 'string' && filters.tagId ? filters.tagId : null
    }
  }
}

// Migration

/**
 * Builds a config document from the pre-unification storage keys.
 *
 * The legacy column key is double-encoded: the call site ran JSON.stringify and
 * setSetting stringified the result again, so a read yields a JSON *string*
 * rather than an array. Both shapes are accepted. A value that is already an
 * array is used directly, so this is safe to run against either.
 */
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
    // Stored by the old toggle as the string 'true'/'false'; `bool` in
    // normalizeBoardConfig accepts both that and a real boolean.
    swimlanes: rawSwimlanes ?? false,
    cardDisplay: DEFAULT_CARD_DISPLAY,
    filters: DEFAULT_FILTERS
  })
}


/** Resolves a column by id first, then by case-insensitive name. */
export function findColumn(config: BoardConfig, target: string): ColumnConfig | undefined {
  const needle = target.trim().toLowerCase()
  return (
    config.columns.find(c => c.id.toLowerCase() === needle) ??
    config.columns.find(c => c.name.toLowerCase() === needle)
  )
}
