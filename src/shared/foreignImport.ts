/**
 * Reading a board exported from another app. Parsing only: the caller writes
 * the config and creates items through the ordinary paths, so an imported
 * workspace is an ordinary one the moment it exists.
 *
 * Nothing is silently dropped. Trello marks archived lists and cards
 * `closed: true`; those cards arrive archived and those lists are reported,
 * because a migration that quietly loses data is the worst kind of importer.
 * Todoist gets the same treatment: completed tasks arrive archived, and
 * anything a format cannot carry is said out loud in `notes`.
 */

import type { ItemPriority } from './types'

type ImportSource = 'trello' | 'todoist'

interface ImportedColumn {
  id: string
  name: string
}

interface ImportedCard {
  title: string
  body: string
  /** Resolved column id, or 'archived'. */
  status: string
  position: number
  due_at: number | null
  priority: ItemPriority
  /** Labels, with the colour Trello gave them, to become tags. */
  labels: { name: string; color: string }[]
  checklist: { text: string; done: boolean }[]
}

export interface ImportedBoard {
  source: ImportSource
  /** The board's own name, offered as the workspace name. */
  name: string
  columns: ImportedColumn[]
  cards: ImportedCard[]
  /** Human-readable notes about anything that could not be carried over. */
  notes: string[]
}

// Trello

/** Trello's named colours, mapped onto hex so labels survive as tags. */
const TRELLO_LABEL_COLORS: Record<string, string> = {
  green: '#61bd4f',
  yellow: '#f2d600',
  orange: '#ff9f1a',
  red: '#eb5a46',
  purple: '#c377e0',
  blue: '#0079bf',
  sky: '#00c2e0',
  lime: '#51e898',
  pink: '#ff78cb',
  black: '#344563'
}

export function trelloLabelColor(color: unknown): string {
  const key = typeof color === 'string' ? color.replace(/_(light|dark)$/, '') : ''
  return TRELLO_LABEL_COLORS[key] ?? '#6b7280'
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Column ids follow the same rule the board templates use, so an imported
 * column and a hand-made one of the same name agree. Two lists can share a
 * name, though, and a duplicate id would silently merge them. Hence the
 * uniqueness pass.
 */
function columnId(name: string, taken: Set<string>): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, '_') || 'column'
  let id = base
  let n = 2
  while (taken.has(id)) { id = `${base}_${n}`; n++ }
  taken.add(id)
  return id
}

/** True when the object looks like a board export from somewhere we know. */
export function detectImportSource(parsed: unknown): ImportSource | null {
  const o = asObject(parsed)
  if (!o) return null
  // Trello always carries both, and Checkpoint's own export carries neither.
  if (Array.isArray(o.lists) && Array.isArray(o.cards)) return 'trello'
  // Todoist calls its tasks `items` in the Sync API and `tasks` in the REST
  // one. Projects come with both, and are what tells this apart from
  // Checkpoint's own export, which also has `items`.
  if (Array.isArray(o.projects) && (Array.isArray(o.items) || Array.isArray(o.tasks))) return 'todoist'
  return null
}

export function parseTrelloBoard(parsed: unknown): ImportedBoard | null {
  const o = asObject(parsed)
  if (!o || !Array.isArray(o.lists) || !Array.isArray(o.cards)) return null

  const notes: string[] = []

  // Lists in the order Trello shows them. `pos` is a float, not an index.
  const openLists = asArray(o.lists)
    .map(asObject)
    .filter((l): l is Record<string, unknown> => l !== null)
    .filter(l => l.closed !== true)
    .sort((a, b) => Number(a.pos ?? 0) - Number(b.pos ?? 0))

  const archivedListCount = asArray(o.lists).filter(l => asObject(l)?.closed === true).length
  if (archivedListCount > 0) {
    notes.push(`${archivedListCount} archived list${archivedListCount === 1 ? '' : 's'} were not imported.`)
  }

  const taken = new Set<string>()
  const columns: ImportedColumn[] = []
  /** Trello list id → Checkpoint column id. */
  const listToColumn = new Map<string, string>()

  for (const list of openLists) {
    const name = str(list.name).trim() || 'Untitled'
    const id = columnId(name, taken)
    columns.push({ id, name })
    listToColumn.set(str(list.id), id)
  }

  if (columns.length === 0) return null

  // Checklists are stored alongside the cards, keyed by card id.
  const checklistsByCard = new Map<string, { text: string; done: boolean }[]>()
  for (const raw of asArray(o.checklists)) {
    const cl = asObject(raw)
    if (!cl) continue
    const cardId = str(cl.idCard)
    if (!cardId) continue
    const items = asArray(cl.checkItems)
      .map(asObject)
      .filter((i): i is Record<string, unknown> => i !== null)
      .sort((a, b) => Number(a.pos ?? 0) - Number(b.pos ?? 0))
      .map(i => ({ text: str(i.name), done: i.state === 'complete' }))
      .filter(i => i.text)
    if (items.length === 0) continue
    checklistsByCard.set(cardId, [...(checklistsByCard.get(cardId) ?? []), ...items])
  }

  const perColumn = new Map<string, number>()
  const cards: ImportedCard[] = []

  const sortedCards = asArray(o.cards)
    .map(asObject)
    .filter((c): c is Record<string, unknown> => c !== null)
    .sort((a, b) => Number(a.pos ?? 0) - Number(b.pos ?? 0))

  let orphaned = 0
  for (const card of sortedCards) {
    const title = str(card.name).trim()
    if (!title) continue

    const archived = card.closed === true
    const mapped = listToColumn.get(str(card.idList))
    // A card whose list was archived has nowhere to land. Rather than dropping
    // it, it goes to the first column. Visible, and therefore fixable.
    if (!mapped && !archived) orphaned++
    const status = archived ? 'archived' : (mapped ?? columns[0].id)

    const seen = perColumn.get(status) ?? 0
    perColumn.set(status, seen + 1)

    const dueRaw = str(card.due)
    const due = dueRaw ? Date.parse(dueRaw) : NaN

    cards.push({
      title,
      body: str(card.desc),
      status,
      position: (seen + 1) * 1000,
      due_at: Number.isFinite(due) ? due : null,
      // Trello has no priority; guessing one would be inventing data.
      priority: 0,
      labels: asArray(card.labels)
        .map(asObject)
        .map(l => ({ name: str(l?.name).trim(), color: trelloLabelColor(l?.color) }))
        .filter(l => l.name),
      checklist: checklistsByCard.get(str(card.id)) ?? []
    })
  }

  if (orphaned > 0) {
    notes.push(`${orphaned} card${orphaned === 1 ? '' : 's'} came from an archived list and were placed in "${columns[0].name}".`)
  }

  const archivedCards = cards.filter(c => c.status === 'archived').length
  if (archivedCards > 0) {
    notes.push(`${archivedCards} archived card${archivedCards === 1 ? '' : 's'} were imported as archived.`)
  }

  return {
    source: 'trello',
    name: str(o.name).trim() || 'Imported board',
    columns,
    cards,
    notes
  }
}


// Todoist

/**
 * Todoist's palette, by the names its exports use. Older exports carry a
 * numeric colour id instead, which is not worth a second table: an unknown
 * colour becomes grey and the label still arrives.
 */
const TODOIST_LABEL_COLORS: Record<string, string> = {
  berry_red: '#b8256f',
  red: '#db4035',
  orange: '#ff9933',
  yellow: '#fad000',
  olive_green: '#afb83b',
  lime_green: '#7ecc49',
  green: '#299438',
  mint_green: '#6accbc',
  teal: '#158fad',
  sky_blue: '#14aaf5',
  light_blue: '#96c3eb',
  blue: '#4073ff',
  grape: '#884dff',
  violet: '#af38eb',
  lavender: '#eb96eb',
  magenta: '#e05194',
  salmon: '#ff8d85',
  charcoal: '#808080',
  grey: '#b8b8b8',
  taupe: '#ccac93'
}

function todoistLabelColor(color: unknown): string {
  return TODOIST_LABEL_COLORS[str(color)] ?? '#6b7280'
}

/**
 * Todoist has four levels against Checkpoint's four, so this is a straight
 * shift rather than a judgement call. p4 is Todoist's default and means "no
 * priority set", which is Checkpoint's 0.
 *
 * The catch is that the two exports number them in opposite directions. The
 * API calls the urgent one 4; the template CSV calls it 1. Getting that
 * backwards would invert every priority in the board and look like nothing
 * was wrong, so the two directions are separate functions with separate tests.
 */
function shiftPriority(level: number): ItemPriority {
  const clamped = Math.min(4, Math.max(1, Math.round(level)))
  return (clamped - 1) as ItemPriority
}

/** Sync/REST API numbering, where 4 is p1 and 1 is p4. */
export function todoistPriorityFromApi(raw: unknown): ItemPriority {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 0
  return shiftPriority(n)
}

/** Template CSV numbering, where 1 is p1 and 4 is p4. An empty cell is p4. */
export function todoistPriorityFromCsv(raw: unknown): ItemPriority {
  const n = Number(str(raw).trim())
  if (!Number.isFinite(n) || n < 1) return 0
  return shiftPriority(5 - n)
}

/** Todoist writes `YYYY-MM-DD` for an all-day due date and RFC3339 with a time. */
function todoistDue(raw: unknown): number | null {
  const o = asObject(raw)
  const text = str(o ? (o.date ?? o.datetime) : raw).trim()
  if (!text) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : null
}

function todoistTasks(o: Record<string, unknown>): Record<string, unknown>[] {
  const raw = Array.isArray(o.items) ? o.items : o.tasks
  return asArray(raw)
    .map(asObject)
    .filter((t): t is Record<string, unknown> => t !== null)
}

/**
 * Labels are strings in the REST API and numeric ids into a `labels` table in
 * the Sync one. Both end up as names with a colour.
 */
function todoistLabels(o: Record<string, unknown>): Map<string, { name: string; color: string }> {
  const byId = new Map<string, { name: string; color: string }>()
  for (const raw of asArray(o.labels)) {
    const label = asObject(raw)
    if (!label) continue
    const name = str(label.name).trim()
    if (!name) continue
    byId.set(String(label.id ?? name), { name, color: todoistLabelColor(label.color) })
  }
  return byId
}

export function parseTodoistBoard(parsed: unknown): ImportedBoard | null {
  const o = asObject(parsed)
  if (!o) return null

  const tasks = todoistTasks(o)
  const projects = asArray(o.projects)
    .map(asObject)
    .filter((p): p is Record<string, unknown> => p !== null)
    .filter(p => p.is_deleted !== true)
  if (projects.length === 0) return null

  const notes: string[] = []
  const labelsById = todoistLabels(o)

  const sections = asArray(o.sections)
    .map(asObject)
    .filter((sec): sec is Record<string, unknown> => sec !== null)
    .filter(sec => sec.is_deleted !== true)
    .sort((a, b) => Number(a.section_order ?? a.order ?? 0) - Number(b.section_order ?? b.order ?? 0))

  const taken = new Set<string>()
  const columns: ImportedColumn[] = []
  /** Whatever a task is grouped by, mapped to the column it lands in. */
  const groupToColumn = new Map<string, string>()

  /**
   * One project's sections make good columns. Several projects do not have
   * comparable sections, so the projects themselves become the columns and the
   * sections are reported as flattened rather than silently lost.
   */
  const bySection = projects.length === 1 && sections.length > 0

  if (bySection) {
    // Tasks with no section come first: that is where Todoist shows them.
    const loose = columnId('Tasks', taken)
    columns.push({ id: loose, name: 'Tasks' })
    groupToColumn.set('', loose)
    for (const section of sections) {
      const name = str(section.name).trim() || 'Untitled'
      const id = columnId(name, taken)
      columns.push({ id, name })
      groupToColumn.set(String(section.id), id)
    }
  } else {
    for (const project of projects) {
      const name = str(project.name).trim() || 'Untitled'
      const id = columnId(name, taken)
      columns.push({ id, name })
      groupToColumn.set(String(project.id), id)
    }
    if (sections.length > 0) {
      notes.push(`Sections were flattened: with more than one project, the projects became the columns.`)
    }
  }

  if (columns.length === 0) return null

  const ordered = [...tasks].sort(
    (a, b) => Number(a.child_order ?? a.order ?? 0) - Number(b.child_order ?? b.order ?? 0)
  )

  /**
   * Sub-tasks become checklist items on their parent, which is the closest
   * thing Checkpoint has and keeps them attached to the work they belong to.
   */
  const childrenByParent = new Map<string, { text: string; done: boolean }[]>()
  for (const task of ordered) {
    const parent = str(task.parent_id)
    if (!parent) continue
    const text = str(task.content).trim()
    if (!text) continue
    const done = task.checked === true || task.is_completed === true || task.completed === true
    childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), { text, done }])
  }

  const perColumn = new Map<string, number>()
  const cards: ImportedCard[] = []
  let completed = 0

  for (const task of ordered) {
    if (str(task.parent_id)) continue
    const title = str(task.content).trim()
    if (!title) continue

    const group = bySection ? str(task.section_id) : str(task.project_id)
    const done = task.checked === true || task.is_completed === true || task.completed === true
    // A finished task is archived rather than dropped, the same as Trello's.
    if (done) completed++
    const status = done ? 'archived' : (groupToColumn.get(group) ?? columns[0].id)

    const seen = perColumn.get(status) ?? 0
    perColumn.set(status, seen + 1)

    const names = asArray(task.labels).map(l => {
      const known = labelsById.get(String(l))
      return known ?? { name: str(l).trim(), color: todoistLabelColor(undefined) }
    })
    const ids = asArray(task.label_ids)
      .map(id => labelsById.get(String(id)))
      .filter((l): l is { name: string; color: string } => !!l)

    cards.push({
      title,
      body: str(task.description),
      status,
      position: (seen + 1) * 1000,
      due_at: todoistDue(task.due ?? task.due_date),
      priority: todoistPriorityFromApi(task.priority),
      labels: [...names, ...ids].filter(l => l.name),
      checklist: childrenByParent.get(String(task.id)) ?? []
    })
  }

  if (completed > 0) {
    notes.push(`${completed} completed task${completed === 1 ? '' : 's'} were imported as archived.`)
  }

  const name = projects.length === 1
    ? (str(projects[0].name).trim() || 'Imported board')
    : 'Todoist'

  return { source: 'todoist', name, columns, cards, notes }
}

// Todoist's template CSV

/**
 * A comma-separated file, quotes and all.
 *
 * Hand-written rather than pulled in: Todoist task descriptions routinely
 * contain commas and newlines inside quoted fields, and the naive split that
 * "just a CSV" suggests would tear those rows in half.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  // A BOM survives Excel round-trips and would otherwise become part of the
  // first header name, which is how header matching quietly stops working.
  const input = text.replace(/^\uFEFF/, '')

  for (let i = 0; i < input.length; i++) {
    const c = input[i]

    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else {
        field += c
      }
      continue
    }

    if (c === '"') { quoted = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    if (c === '\r') continue
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += c
  }

  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/** Todoist's own header, which is how a CSV is recognised as one of theirs. */
export function isTodoistCsv(text: string): boolean {
  const [header] = parseCsv(text)
  if (!header) return false
  const columns = header.map(h => h.trim().toUpperCase())
  return columns.includes('TYPE') && columns.includes('CONTENT') && columns.includes('INDENT')
}

/**
 * A project exported with "Export as template". It carries no project name, so
 * the caller passes the filename, which is what Todoist names the download.
 */
export function parseTodoistCsv(text: string, fallbackName = 'Imported board'): ImportedBoard | null {
  const rows = parseCsv(text)
  if (rows.length < 2) return null

  const header = rows[0].map(h => h.trim().toUpperCase())
  const at = (row: string[], column: string): string => {
    const index = header.indexOf(column)
    return index === -1 ? '' : (row[index] ?? '')
  }
  if (!header.includes('TYPE') || !header.includes('CONTENT')) return null

  const notes: string[] = []
  const taken = new Set<string>()
  const columns: ImportedColumn[] = []
  const cards: ImportedCard[] = []
  const perColumn = new Map<string, number>()

  // Tasks written before any section header belong to no section, so there is
  // always a column for them. Named for the project, so a file with no
  // sections at all reads as one column rather than a stray "Tasks".
  const firstId = columnId(fallbackName, taken)
  columns.push({ id: firstId, name: fallbackName })
  let current = firstId
  let sectionsSeen = 0

  /** The most recent task at each indent, so a sub-task can find its parent. */
  const parents: (ImportedCard | null)[] = []
  let skippedNotes = 0

  for (const row of rows.slice(1)) {
    const type = at(row, 'TYPE').trim().toLowerCase()
    const content = at(row, 'CONTENT')

    if (type === 'section') {
      const name = content.trim() || 'Untitled'
      const id = columnId(name, taken)
      columns.push({ id, name })
      current = id
      sectionsSeen++
      parents.length = 0
      continue
    }

    if (type === 'note') {
      // A note belongs to the task above it. With no task above it there is
      // nowhere to put it, and inventing a card for it would be worse.
      const owner = parents.filter(Boolean).pop()
      if (owner) owner.body = owner.body ? `${owner.body}\n\n${content}` : content
      else skippedNotes++
      continue
    }

    if (type !== 'task') continue
    const title = content.trim()
    if (!title) continue

    const indent = Math.max(1, Math.round(Number(at(row, 'INDENT')) || 1))

    // Indented rows are sub-tasks, and become checklist items on the nearest
    // task above them rather than cards of their own.
    if (indent > 1) {
      const parent = parents.slice(0, indent - 1).filter(Boolean).pop()
      if (parent) {
        parent.checklist.push({ text: title, done: false })
        continue
      }
      // No parent to attach to, so it lands as an ordinary card rather than
      // being dropped.
    }

    const due = at(row, 'DATE').trim()
    const parsedDue = due ? Date.parse(due) : NaN

    const seen = perColumn.get(current) ?? 0
    perColumn.set(current, seen + 1)

    const card: ImportedCard = {
      title,
      body: at(row, 'DESCRIPTION'),
      status: current,
      position: (seen + 1) * 1000,
      due_at: Number.isFinite(parsedDue) ? parsedDue : null,
      priority: todoistPriorityFromCsv(at(row, 'PRIORITY')),
      // The template CSV carries no labels; there is nothing to read.
      labels: [],
      checklist: []
    }
    cards.push(card)
    parents.length = indent - 1
    parents[indent - 1] = card
  }

  if (cards.length === 0) return null

  if (skippedNotes > 0) {
    notes.push(`${skippedNotes} note${skippedNotes === 1 ? '' : 's'} had no task above them and were not imported.`)
  }
  if (sectionsSeen === 0) {
    notes.push('The export had no sections, so everything is in one column.')
  }
  notes.push('A template export carries no labels or completed tasks. Export the full JSON backup if you need those.')

  return { source: 'todoist', name: fallbackName, columns, cards, notes }
}

/** Parses whatever the file turned out to be, or null if unrecognised. */
export function parseForeignBoard(parsed: unknown): ImportedBoard | null {
  switch (detectImportSource(parsed)) {
    case 'trello': return parseTrelloBoard(parsed)
    case 'todoist': return parseTodoistBoard(parsed)
    default: return null
  }
}

/** "3 columns · 24 cards" for the confirmation dialog. */
export function describeImport(board: ImportedBoard): string {
  const cols = `${board.columns.length} column${board.columns.length === 1 ? '' : 's'}`
  const cards = `${board.cards.length} card${board.cards.length === 1 ? '' : 's'}`
  return `${cols} · ${cards}`
}

/** Every distinct label across the board, with the colour to give its tag. */
export function collectLabels(board: ImportedBoard): { name: string; color: string }[] {
  // First colour wins: Trello allows the same label name under two colours, and
  // a tag can only have one.
  const seen = new Map<string, string>()
  for (const card of board.cards) {
    for (const label of card.labels) {
      if (!seen.has(label.name)) seen.set(label.name, label.color)
    }
  }
  return [...seen.entries()].map(([name, color]) => ({ name, color }))
}
