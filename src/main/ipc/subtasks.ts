/** checklist rows under a task */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerSubtasksHandlers(): void {
  ipcMain.handle(IpcChannels.SUBTASK_LIST, async (_event, itemId: string) => {
    const { getSubtasks } = await import('../db')
    const { normalizeSubtasks } = await import('../../shared/subtasks')
    return normalizeSubtasks(getSubtasks(itemId))
  })

  ipcMain.handle(IpcChannels.SUBTASK_ADD, async (_event, itemId: string, title: string) => {
    const { getSubtasks, insertSubtask } = await import('../db')
    const { normalizeSubtasks, nextPosition } = await import('../../shared/subtasks')
    const clean = String(title ?? '').trim()
    if (!clean) return { ok: false as const, reason: 'A subtask needs a title.' }

    const { randomUUID } = await import('crypto')
    insertSubtask({
      id: randomUUID(),
      item_id: itemId,
      title: clean,
      done: 0,
      position: nextPosition(normalizeSubtasks(getSubtasks(itemId))),
      created_at: Date.now()
    })
    return { ok: true as const }
  })

  ipcMain.handle(
    IpcChannels.SUBTASK_UPDATE,
    async (_event, id: string, patch: { title?: string; done?: boolean; position?: number }) => {
      const { updateSubtask } = await import('../db')
      updateSubtask(id, patch)
      return { ok: true as const }
    }
  )

  ipcMain.handle(IpcChannels.SUBTASK_DELETE, async (_event, id: string) => {
    const { deleteSubtask } = await import('../db')
    deleteSubtask(id)
    return { ok: true as const }
  })

  /** offered, not automatic; body replaced only after every row inserts */
  ipcMain.handle(IpcChannels.SUBTASK_CONVERT, async (_event, itemId: string) => {
    const { getItemById, getSubtasks, insertSubtask, updateItem, getDb } = await import('../db')
    const { parseChecklist, normalizeSubtasks, nextPosition } = await import('../../shared/subtasks')
    const { randomUUID } = await import('crypto')

    const item = getItemById(itemId)
    if (!item) return { ok: false as const, reason: 'That task no longer exists.' }

    const { items, remainingBody } = parseChecklist(item.body)
    if (items.length === 0) return { ok: false as const, reason: 'No checkboxes to convert.' }

    let position = nextPosition(normalizeSubtasks(getSubtasks(itemId)))
    const now = Date.now()
    for (const entry of items) {
      insertSubtask({
        id: randomUUID(),
        item_id: itemId,
        title: entry.title,
        done: entry.done ? 1 : 0,
        position,
        created_at: now
      })
      position += 1000
    }
    updateItem(getDb(), itemId, { body: remainingBody })
    return { ok: true as const, converted: items.length }
  })
}
