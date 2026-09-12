/** Rules that create work on a schedule. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerRecurrenceHandlers(): void {
  ipcMain.handle(IpcChannels.RECURRENCE_LIST, async (_event, context?: string) => {
    const { getRecurrences } = await import('../db')
    const { ruleFromRow } = await import('../recurrenceService')
    const { describeRule } = await import('../../shared/recurrence')
    return getRecurrences(context).map(row => {
      const rule = ruleFromRow(row)
      return {
        id: row.id,
        context: row.context,
        title: row.title,
        type: row.type,
        active: row.active === 1,
        nextDue: row.next_due,
        description: rule ? describeRule(rule) : 'Unreadable rule'
      }
    })
  })

  ipcMain.handle(IpcChannels.RECURRENCE_CREATE, async (_event, input: unknown) => {
    const { createRecurrence, materialiseDueRecurrences } = await import('../recurrenceService')
    const row = createRecurrence(input as Parameters<typeof createRecurrence>[0])
    if (!row) return { ok: false, reason: 'That repeat rule could not be understood.' }
    // Swept at once so a rule that is already due produces its first item now
    // rather than on the next hourly pass.
    materialiseDueRecurrences()
    return { ok: true, id: row.id }
  })

  ipcMain.handle(IpcChannels.RECURRENCE_DELETE, async (_event, id: string) => {
    const { deleteRecurrence } = await import('../db')
    deleteRecurrence(id)
    return { ok: true }
  })

  ipcMain.handle(IpcChannels.RECURRENCE_SET_ACTIVE, async (_event, id: string, active: boolean) => {
    const { setRecurrenceActive } = await import('../db')
    setRecurrenceActive(id, active)
    return { ok: true }
  })
}
