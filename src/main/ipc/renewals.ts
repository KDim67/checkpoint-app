/** things that expire; every handler answers with a result, a throw would reach the renderer as main's stack */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import type { RenewalResult } from '../../shared/renewalApi'

/** a registry can take seconds, so nobody waits on it; the window reloads when it answers */
function lookUpLater(id: string): void {
  void (async () => {
    try {
      const { lookupRenewal } = await import('../renewalLookup')
      const looked = await lookupRenewal(id)
      if (!looked.ok) return
      const { sendToWindow } = await import('../windows')
      sendToWindow(IpcChannels.MCP_DATA_CHANGED)
    } catch (err) {
      console.error('[renewals] Lookup after a change failed:', err)
    }
  })()
}

async function guarded<T>(what: string, fn: () => RenewalResult<T> | Promise<RenewalResult<T>>): Promise<RenewalResult<T>> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[renewals] Could not ${what}:`, err)
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export function registerRenewalsHandlers(): void {
  ipcMain.handle(IpcChannels.RENEWALS_LIST, (_event, context?: string) =>
    guarded('list renewals', async () => {
      const { listRenewals } = await import('../renewals')
      return { ok: true, value: listRenewals(typeof context === 'string' && context ? context : undefined) }
    })
  )

  ipcMain.handle(IpcChannels.RENEWALS_CREATE, (_event, input) =>
    guarded('create a renewal', async () => {
      const { createRenewal } = await import('../renewals')
      const created = createRenewal(input)
      // the date is often what the lookup is for, so it starts now rather than at the next sweep
      if (created.ok && created.value.meta.lookup?.auto) lookUpLater(created.value.id)
      return created
    })
  )

  ipcMain.handle(IpcChannels.RENEWALS_UPDATE, (_event, id: string, patch) =>
    guarded('save the renewal', async () => {
      const { getRenewal, updateRenewal } = await import('../renewals')
      const before = getRenewal(id)?.meta.lookup ?? null
      const saved = updateRenewal(id, patch)
      const after = saved.ok ? saved.value.meta.lookup : null
      // a new domain or host is checked now; waiting for the sweep would leave the date blank for minutes
      if (after?.auto && (before?.target !== after.target || before?.port !== after.port || !before.auto)) lookUpLater(id)
      return saved
    })
  )

  ipcMain.handle(IpcChannels.RENEWALS_RENEWED, (_event, id: string, to?: number | null) =>
    guarded('mark it renewed', async () => {
      const { markRenewed } = await import('../renewals')
      const renewed = markRenewed(id, to ?? null)
      // renewed for now; the registry confirming it, or showing a later date, lands when it answers
      if (renewed.ok && renewed.value.record.meta.lookup) lookUpLater(id)
      return renewed
    })
  )

  ipcMain.handle(IpcChannels.RENEWALS_RESTORE, (_event, snapshot) =>
    guarded('undo that', async () => (await import('../renewals')).restoreRenewal(snapshot))
  )

  ipcMain.handle(IpcChannels.RENEWALS_DELETE, (_event, id: string) =>
    guarded('delete the renewal', async () => (await import('../renewals')).deleteRenewal(id))
  )

  ipcMain.handle(IpcChannels.RENEWALS_SNOOZE, (_event, id: string, until: number | null) =>
    guarded('snooze it', async () => (await import('../renewals')).snoozeRenewal(id, until))
  )

  ipcMain.handle(IpcChannels.RENEWALS_CHECK_NOW, (_event, id: string) =>
    guarded('check the date', async () => (await import('../renewalLookup')).lookupRenewal(id))
  )

  ipcMain.handle(IpcChannels.RENEWALS_KINDS_GET, () =>
    guarded('read the kinds', async () => ({ ok: true, value: (await import('../renewals')).getKinds() }))
  )

  ipcMain.handle(IpcChannels.RENEWALS_KINDS_SET, (_event, kinds: unknown) =>
    guarded('save the kinds', async () => (await import('../renewals')).saveKinds(kinds))
  )

  ipcMain.handle(
    IpcChannels.RENEWALS_KINDS_RENAME,
    (_event, kindId: string, fieldId: string, label: string, alsoEntries: boolean) =>
      guarded('rename the field', async () =>
        (await import('../renewals')).renameTemplateField(kindId, fieldId, label, alsoEntries === true)
      )
  )

  ipcMain.handle(IpcChannels.RENEWALS_FIELD_USES, (_event, fieldId: string) =>
    guarded('count the field', async () => ({ ok: true, value: (await import('../renewals')).templateFieldUses(fieldId) }))
  )
}
