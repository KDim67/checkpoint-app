/**
 * Turning Checkpoint's data into files you can take elsewhere.
 *
 * A local-first tool with no way out is asking for trust it has not earned, so
 * this exists mainly as a promise kept. The serialising is pure and tested
 * because the failure mode is quiet: a card body containing a comma, a quote or
 * a newline produces a CSV that opens without complaint and is wrong.
 */

import type { Item } from './types'

export type ExportFormat = 'markdown' | 'csv' | 'json'

export const EXPORT_FORMATS: { id: ExportFormat; label: string; extension: string }[] = [
  { id: 'markdown', label: 'Markdown', extension: 'md' },
  { id: 'csv', label: 'CSV (spreadsheet)', extension: 'csv' },
  { id: 'json', label: 'JSON (everything)', extension: 'json' }
]

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r']

/**
 * Escapes one CSV field per RFC 4180, and defuses spreadsheet formulas.
 *
 * Cards can be written by webhooks and by agents over MCP, so a title is not
 * necessarily something the user typed, and a field opening with `=` would run
 * on open in Excel. The visible leading apostrophe is the accepted trade.
 */
export function escapeCsvField(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (text.length > 0 && FORMULA_LEADERS.includes(text[0])) text = `'${text}`
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/** Joins rows into a CSV document, header first. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvField).join(',')]
  for (const row of rows) lines.push(row.map(escapeCsvField).join(','))
  // A trailing newline: most tools want one, and none mind it.
  return lines.join('\r\n') + '\r\n'
}

const ITEM_HEADERS = [
  'id', 'type', 'context', 'title', 'body', 'status',
  'priority', 'due', 'created', 'updated', 'tags'
]

const iso = (ms: number | null | undefined): string =>
  ms === null || ms === undefined ? '' : new Date(ms).toISOString()

export function itemsToCsv(items: Item[]): string {
  return toCsv(
    ITEM_HEADERS,
    items.map(i => [
      i.id, i.type, i.context, i.title, i.body, i.status, i.priority,
      iso(i.due_at), iso(i.created_at), iso(i.updated_at),
      (i.tags ?? []).map(t => t.name).join('; ')
    ])
  )
}

const PRIORITY_LABELS: Record<number, string> = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High' }

/**
 * A readable document rather than a data dump.
 *
 * Grouped by status because that is how the board is organised, so an exported
 * file lines up with what the user was looking at when they exported it.
 */
export function itemsToMarkdown(items: Item[], title = 'Checkpoint export'): string {
  const out: string[] = [`# ${title}`, '']

  const byStatus = new Map<string, Item[]>()
  for (const item of items) {
    const list = byStatus.get(item.status) ?? []
    list.push(item)
    byStatus.set(item.status, list)
  }

  if (byStatus.size === 0) {
    out.push('_Nothing to export._', '')
    return out.join('\n')
  }

  for (const [status, group] of byStatus) {
    out.push(`## ${status}`, '')
    for (const item of group) {
      // A checkbox, so the export is still usable as a working list.
      out.push(`- [${item.status === 'done' ? 'x' : ' '}] **${item.title || '(untitled)'}**`)

      const meta: string[] = []
      if (item.priority) meta.push(PRIORITY_LABELS[item.priority] ?? String(item.priority))
      if (item.due_at) meta.push(`due ${new Date(item.due_at).toLocaleDateString()}`)
      const tags = (item.tags ?? []).map(t => t.name)
      if (tags.length > 0) meta.push(tags.map(t => `\`${t}\``).join(' '))
      if (meta.length > 0) out.push(`  ${meta.join(' · ')}`)

      if (item.body.trim()) {
        // Indented so the body stays inside its bullet rather than ending the list.
        for (const line of item.body.trim().split('\n')) out.push(`  ${line}`)
      }
    }
    out.push('')
  }
  return out.join('\n')
}

interface JsonExport {
  exportedAt: string
  context: string | null
  itemCount: number
  items: Item[]
}

/** The lossless option: everything, in the shape the app stores it. */
export function toJsonExport(items: Item[], context: string | null, exportedAt: number): string {
  const payload: JsonExport = {
    exportedAt: new Date(exportedAt).toISOString(),
    context,
    itemCount: items.length,
    items
  }
  return JSON.stringify(payload, null, 2)
}

/** Filename for an export, safe on every platform. */
export function exportFilename(context: string | null, format: ExportFormat, at: number): string {
  const extension = EXPORT_FORMATS.find(f => f.id === format)?.extension ?? 'txt'
  const date = new Date(at).toISOString().slice(0, 10)
  const scope = (context ?? 'all-workspaces').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-|-$/g, '')
  return `checkpoint-${scope || 'export'}-${date}.${extension}`
}
