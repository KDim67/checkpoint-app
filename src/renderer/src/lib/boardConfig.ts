/**
 * The single source of truth for how a Kanban board is configured.
 *
 * Configuration used to be scattered: columns under one settings key written
 * from one helper, the background under another written inline from four
 * separate call sites in the picker, and the swimlane toggle nowhere at all, 
 * it was component state, so it silently reverted on every reload. Nothing
 * described "this board's setup" as one thing, which is also why the assistant
 * could not be given a handle on it.
 *
 * Everything now lives in one versioned document per workspace. `app_settings`
 * rows are already part of the P2P sync payload and are not caught by the
 * sensitive-key filter, so board configuration follows a workspace between
 * machines without any extra plumbing.
 */

import { withLock } from './asyncMutex'

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
  /** Short policy note, a definition of done, surfaced on hover. */
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
  /** Preset id, hex colour, CSS gradient, or image url, as the picker writes it. */
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

const COLUMN_SORTS: ColumnSort[] = ['manual', 'priority', 'due']

// Storage keys

export const boardConfigKey = (context: string): string => `kanban_board_${context}`
const legacyColumnsKey = (context: string): string => `kanban_columns_${context}`
const legacyBackgroundKey = (context: string): string => `kanban_bg_${context}`
const legacyArchivedKey = (context: string): string => `kanban_archived_columns_${context}`

/**
 * Every mutation serialises on the key the board bootstrap and the AI action
 * blocks already share. Config writes are read-modify-write, which is exactly
 * the sequence that produced duplicate columns when two of them interleaved.
 */
const lockKey = (context: string): string => `kanban-cols:${context}`

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

  if (typeof o.color === 'string' && o.color.trim()) column.color = o.color.trim()
  if (o.colorMode === 'full' || o.colorMode === 'header') column.colorMode = o.colorMode
  if (o.collapsed !== undefined) column.collapsed = bool(o.collapsed, false)
  if (COLUMN_SORTS.includes(o.sort as ColumnSort)) column.sort = o.sort as ColumnSort
  if (typeof o.description === 'string' && o.description.trim()) {
    column.description = o.description.trim()
  }
  return column
}

/**
 * Produces a valid config from anything. A partial, stale or corrupted document
 * degrades to defaults rather than throwing, this runs on every board load, and
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
 * rather than an array. Both shapes are accepted, a value that is already an
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
  rawArchived?: unknown
): BoardConfig {
  return normalizeBoardConfig({
    columns: decodeLegacyList(rawColumns),
    archivedColumns: decodeLegacyList(rawArchived),
    background: typeof rawBackground === 'string' && rawBackground ? rawBackground : 'default',
    swimlanes: false,
    cardDisplay: DEFAULT_CARD_DISPLAY,
    filters: DEFAULT_FILTERS
  })
}

// Persistence

/**
 * Loads a board's configuration, migrating from the legacy keys the first time.
 * Never rejects: a failed read yields defaults so the board still renders.
 */
/**
 * Reads and normalises without taking the lock, migrating in memory only.
 * Private: every caller that also writes must hold the lock around both halves,
 * and nesting withLock on the same key would deadlock.
 */
async function readUnlocked(context: string): Promise<{ config: BoardConfig; migrated: boolean }> {
  const stored = await window.electronAPI.db.getSetting(boardConfigKey(context))
  if (stored !== null && stored !== undefined && stored !== '') {
    return { config: normalizeBoardConfig(stored), migrated: false }
  }

  const [legacyColumns, legacyBackground, legacyArchived] = await Promise.all([
    window.electronAPI.db.getSetting(legacyColumnsKey(context)),
    window.electronAPI.db.getSetting(legacyBackgroundKey(context)),
    window.electronAPI.db.getSetting(legacyArchivedKey(context))
  ])
  return { config: migrateLegacy(legacyColumns, legacyBackground, legacyArchived), migrated: true }
}

async function writeUnlocked(context: string, config: BoardConfig): Promise<void> {
  // Passed as an object, so setSetting encodes it exactly once. The legacy
  // column key was stringified by its caller as well, producing a
  // double-encoded value; not repeating that is what keeps reads simple.
  await window.electronAPI.db.setSetting(boardConfigKey(context), config)
}

/**
 * Loads a board's configuration, migrating from the legacy keys the first time.
 * Never rejects: a failed read yields defaults so the board still renders.
 */
export async function loadBoardConfig(context: string): Promise<BoardConfig> {
  try {
    return await withLock(lockKey(context), async () => {
      const { config, migrated } = await readUnlocked(context)
      // Written back on first read so the migration happens once rather than on
      // every load. The legacy keys are deliberately left in place for a
      // release as a fallback.
      if (migrated) await writeUnlocked(context, config)
      return config
    })
  } catch (err) {
    console.error('[boardConfig] Could not load board config:', err)
    return normalizeBoardConfig(null)
  }
}

export async function saveBoardConfig(context: string, config: BoardConfig): Promise<void> {
  const normalized = normalizeBoardConfig(config)
  await withLock(lockKey(context), () => writeUnlocked(context, normalized))
}

/**
 * Read-modify-write of a subset of the document, serialised against every other
 * config mutation. Returns the stored result.
 *
 * Callers must use this rather than load-then-save: the gap between a separate
 * read and write is exactly where a concurrent AI action block can interleave
 * and lose one side's changes.
 */
export async function patchBoardConfig(
  context: string,
  patch: Partial<BoardConfig>
): Promise<BoardConfig> {
  return withLock(lockKey(context), async () => {
    const { config } = await readUnlocked(context)
    const next = normalizeBoardConfig({ ...config, ...patch })
    await writeUnlocked(context, next)
    return next
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
