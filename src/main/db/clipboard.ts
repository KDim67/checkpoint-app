import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { ClipboardItem } from '../../shared/types'

let stmtGetClipboardHistory: Database.Statement
let stmtInsertClipboardItem: Database.Statement
let stmtFindClipboardItemByContent: Database.Statement
let stmtUpdateClipboardItemTimestamp: Database.Statement
let stmtUpdateClipboardItemPin: Database.Statement
let stmtUpdateClipboardItemLabel: Database.Statement
let stmtDeleteClipboardItem: Database.Statement
let stmtClearClipboardHistory: Database.Statement
let stmtDeleteClipboardHistoryOverflow: Database.Statement

export function prepareClipboardStatements(db: Database.Database): void {
  stmtGetClipboardHistory = db.prepare(`
    SELECT * FROM clipboard_items ORDER BY is_pinned DESC, created_at DESC
  `)
  stmtInsertClipboardItem = db.prepare(`
    INSERT INTO clipboard_items (id, content, is_pinned, label, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmtFindClipboardItemByContent = db.prepare(`
    SELECT id, is_pinned FROM clipboard_items WHERE content = ? LIMIT 1
  `)
  stmtUpdateClipboardItemTimestamp = db.prepare(`
    UPDATE clipboard_items SET created_at = ? WHERE id = ?
  `)
  stmtUpdateClipboardItemPin = db.prepare(`
    UPDATE clipboard_items SET is_pinned = ? WHERE id = ?
  `)
  stmtUpdateClipboardItemLabel = db.prepare(`
    UPDATE clipboard_items SET label = ? WHERE id = ?
  `)
  stmtDeleteClipboardItem = db.prepare(`
    DELETE FROM clipboard_items WHERE id = ?
  `)
  stmtClearClipboardHistory = db.prepare(`
    DELETE FROM clipboard_items WHERE is_pinned = 0
  `)
  stmtDeleteClipboardHistoryOverflow = db.prepare(`
    DELETE FROM clipboard_items WHERE is_pinned = 0 AND id NOT IN (
      SELECT id FROM clipboard_items WHERE is_pinned = 0 ORDER BY created_at DESC LIMIT 200
    )
  `)
}

export function getClipboardHistory(): ClipboardItem[] {
  const rows = stmtGetClipboardHistory.all() as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    content: row.content as string,
    is_pinned: row.is_pinned as number,
    label: row.label as string | null,
    created_at: row.created_at as number
  }))
}

export function recordClipboardCopy(content: string): void {
  const existing = stmtFindClipboardItemByContent.get(content) as { id: string; is_pinned: number } | undefined
  const now = Date.now()
  if (existing) {
    stmtUpdateClipboardItemTimestamp.run(now, existing.id)
  } else {
    const id = uuidv4()
    stmtInsertClipboardItem.run(id, content, 0, null, now)
    stmtDeleteClipboardHistoryOverflow.run()
  }
}

export function createClipboardSnippet(content: string, label: string | null): void {
  const existing = stmtFindClipboardItemByContent.get(content) as { id: string; is_pinned: number } | undefined
  const now = Date.now()
  if (existing) {
    stmtUpdateClipboardItemTimestamp.run(now, existing.id)
    stmtUpdateClipboardItemPin.run(1, existing.id)
    if (label) {
      stmtUpdateClipboardItemLabel.run(label, existing.id)
    }
  } else {
    const id = uuidv4()
    stmtInsertClipboardItem.run(id, content, 1, label || null, now)
    stmtDeleteClipboardHistoryOverflow.run()
  }
}

export function toggleClipboardPin(id: string, isPinned: boolean): void {
  stmtUpdateClipboardItemPin.run(isPinned ? 1 : 0, id)
}

export function updateClipboardLabel(id: string, label: string | null): void {
  stmtUpdateClipboardItemLabel.run(label || null, id)
}

export function deleteClipboardItem(id: string): void {
  stmtDeleteClipboardItem.run(id)
}

export function restoreClipboardItem(content: string, isPinned: boolean, label: string | null): void {
  const existing = stmtFindClipboardItemByContent.get(content) as { id: string; is_pinned: number } | undefined
  const now = Date.now()
  if (existing) {
    stmtUpdateClipboardItemTimestamp.run(now, existing.id)
    stmtUpdateClipboardItemPin.run(isPinned ? 1 : 0, existing.id)
    stmtUpdateClipboardItemLabel.run(label || null, existing.id)
  } else {
    const id = uuidv4()
    stmtInsertClipboardItem.run(id, content, isPinned ? 1 : 0, label || null, now)
    stmtDeleteClipboardHistoryOverflow.run()
  }
}

export function clearClipboardHistory(): void {
  stmtClearClipboardHistory.run()
}
