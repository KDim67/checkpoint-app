/** pure and tested, since broken CSV fails quietly */

import type { Item } from './types'

export type ExportFormat = 'markdown' | 'csv' | 'json'

export const EXPORT_FORMATS: { id: ExportFormat; label: string; extension: string }[] = [
  { id: 'markdown', label: 'Markdown', extension: 'md' },
  { id: 'csv', label: 'CSV (spreadsheet)', extension: 'csv' },
  { id: 'json', label: 'JSON (everything)', extension: 'json' }
]

/** spreadsheet formula starters */
const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r']

/** RFC 4180 plus formula defusing; titles can come from webhooks or agents */
export function escapeCsvField(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (text.length > 0 && FORMULA_LEADERS.includes(text[0])) text = `'${text}`
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvField).join(',')]
  for (const row of rows) lines.push(row.map(escapeCsvField).join(','))
  // trailing newline, most tools want one
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

/** grouped by status, like the board */
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
      // a checkbox so it's still a working list
      out.push(`- [${item.status === 'done' ? 'x' : ' '}] **${item.title || '(untitled)'}**`)

      const meta: string[] = []
      if (item.priority) meta.push(PRIORITY_LABELS[item.priority] ?? String(item.priority))
      if (item.due_at) meta.push(`due ${new Date(item.due_at).toLocaleDateString()}`)
      const tags = (item.tags ?? []).map(t => t.name)
      if (tags.length > 0) meta.push(tags.map(t => `\`${t}\``).join(' '))
      if (meta.length > 0) out.push(`  ${meta.join(' · ')}`)

      if (item.body.trim()) {
        // indented so the body stays in its bullet
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

/** lossless, as stored */
export function toJsonExport(items: Item[], context: string | null, exportedAt: number): string {
  const payload: JsonExport = {
    exportedAt: new Date(exportedAt).toISOString(),
    context,
    itemCount: items.length,
    items
  }
  return JSON.stringify(payload, null, 2)
}

/** safe on every platform */
export function exportFilename(context: string | null, format: ExportFormat, at: number): string {
  const extension = EXPORT_FORMATS.find(f => f.id === format)?.extension ?? 'txt'
  const date = new Date(at).toISOString().slice(0, 10)
  const scope = (context ?? 'all-workspaces').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-|-$/g, '')
  return `checkpoint-${scope || 'export'}-${date}.${extension}`
}
