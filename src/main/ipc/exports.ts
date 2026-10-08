/** items out as markdown, CSV or JSON */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { getMainWindow } from '../windows'
import { dialog } from 'electron'
import { writeFileSync } from 'fs'

export function registerExportsHandlers(): void {
  ipcMain.handle(
    IpcChannels.EXPORT_ITEMS,
    async (_event, options: { context: string | null; format: 'markdown' | 'csv' | 'json' }) => {
      const win = getMainWindow()
      if (!win) return { ok: false as const, reason: 'No window.' }
      const { getAllItemsForExport, listRenewalRows } = await import('../db')
      const { itemsToCsv, itemsToMarkdown, renewalsToMarkdown, toJsonExport, exportFilename, EXPORT_FORMATS } =
        await import('../../shared/exportFormats')

      try {
        // unpaginated and tag-joined, so the file is everything
        const items = getAllItemsForExport(options.context)
        // their own table, so asked for apart; CSV columns are an item's and stay that way
        const renewals = listRenewalRows(options.context ?? undefined)
        const at = Date.now()
        const content =
          options.format === 'csv' ? itemsToCsv(items)
          : options.format === 'json' ? toJsonExport(items, options.context, at, renewals)
          : [itemsToMarkdown(items, options.context ? `Checkpoint, ${options.context}` : 'Checkpoint'), renewalsToMarkdown(renewals)].filter(Boolean).join('\n')

        const spec = EXPORT_FORMATS.find(f => f.id === options.format)
        const { filePath, canceled } = await dialog.showSaveDialog(win, {
          defaultPath: exportFilename(options.context, options.format, at),
          filters: [{ name: spec?.label ?? 'File', extensions: [spec?.extension ?? 'txt'] }]
        })
        if (canceled || !filePath) return { ok: false as const, reason: 'cancelled' }

        writeFileSync(filePath, content, 'utf8')
        return { ok: true as const, filePath, count: items.length }
      } catch (err) {
        console.error('[export] Failed:', err)
        return { ok: false as const, reason: err instanceof Error ? err.message : 'Export failed.' }
      }
    }
  )
}
