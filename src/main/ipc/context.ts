/** export, import and rename a whole workspace */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { basename, extname } from 'path'
import type Database from 'better-sqlite3'
import { IpcChannels } from '../../shared/ipcChannels'
import type { ContextExport } from '../../shared/types'
import { errorMessage } from '../../shared/errors'

/** takes the handle, these run against the caller's connection only */
export function registerContextHandlers(db: Database.Database): void {
    ipcMain.handle(IpcChannels.DB_EXPORT_CONTEXT, async (_event, context: string, contextName: string) => {
      try {
        const window = BrowserWindow.getFocusedWindow()
        if (!window) return { success: false, error: 'No active window' }

        const { filePath } = await dialog.showSaveDialog(window, {
          title: `Export Workspace: ${contextName}`,
          defaultPath: `${contextName.toLowerCase()}-workspace.json`,
          filters: [{ name: 'JSON Workspace', extensions: ['json'] }]
        })

        if (!filePath) return { success: false, cancelled: true }

        const { exportContextData } = await import('../db')
        const payload = exportContextData(db, context)

        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
        return { success: true, filePath }
      } catch (err) {
        console.error('Failed to export workspace context:', err)
        return { success: false, error: errorMessage(err) }
      }
    })

    ipcMain.handle(IpcChannels.DB_IMPORT_CONTEXT, async () => {
      try {
        const window = BrowserWindow.getFocusedWindow()
        if (!window) return { success: false, error: 'No active window' }

        const { filePaths } = await dialog.showOpenDialog(window, {
          title: 'Import a workspace',
          filters: [{ name: 'Checkpoint, Trello or Todoist export', extensions: ['json', 'csv'] }],
          properties: ['openFile']
        })

        if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

        const filePath = filePaths[0]
        const raw = fs.readFileSync(filePath, 'utf8')
        const {
          parseForeignBoard, parseTodoistCsv, isTodoistCsv
        } = await import('../../shared/foreignImport')

        // todoist's template export is a CSV, the only way out without an API token
        if (isTodoistCsv(raw)) {
          // template exports carry no project name, the filename stands in
          const fromCsv = parseTodoistCsv(raw, basename(filePath, extname(filePath)))
          if (fromCsv) return { success: true, foreign: fromCsv }
          return { success: false, error: 'That Todoist export has no tasks in it.' }
        }

        const parsed = JSON.parse(raw)

        // checkpoint's own export
        if (parsed && parsed.context && Array.isArray(parsed.items)) {
          return { success: true, payload: parsed }
        }

        // classified where it's read, so the renderer only sees shapes it knows
        const foreign = parseForeignBoard(parsed)
        if (foreign) return { success: true, foreign }

        return {
          success: false,
          error: 'Not a Checkpoint, Trello or Todoist export. Trello: Board menu → Print, export and share → Export as JSON. Todoist: project menu → Export as template → CSV.'
        }
      } catch (err) {
        console.error('Failed to import workspace context:', err)
        return { success: false, error: errorMessage(err) }
      }
    })

    ipcMain.handle(IpcChannels.DB_IMPORT_CONTEXT_DATA, async (_event, newContextSlug: string, data: ContextExport) => {
      try {
        const { importContextData } = await import('../db')
        importContextData(db, newContextSlug, data)
        return { success: true }
      } catch (err) {
        console.error('Failed to save imported workspace data:', err)
        return { success: false, error: errorMessage(err) }
      }
    })

    ipcMain.handle(IpcChannels.DB_RENAME_CONTEXT, async (_event, oldSlug: string, newSlug: string) => {
      try {
        db.transaction(() => {
          db.prepare('UPDATE items SET context = ? WHERE context = ?').run(newSlug, oldSlug)
          db.prepare('UPDATE focus_sessions SET context = ? WHERE context = ?').run(newSlug, oldSlug)
          db.prepare('UPDATE ai_memories SET context = ? WHERE context = ?').run(newSlug, oldSlug)
          db.prepare('UPDATE activity_tracking_logs SET context = ? WHERE context = ?').run(newSlug, oldSlug)
        })()
        return { success: true }
      } catch (err) {
        console.error('Failed to rename context:', err)
        return { success: false, error: errorMessage(err) }
      }
    })
}
