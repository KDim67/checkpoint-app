/** the list, the kinds, and every change with its Undo; in one place so the view and its panels agree */

import { useCallback, useEffect, useState } from 'react'
import { useToast, useFailureReport } from '../ui/Toast'
import { useAppStore } from '../../store/appStore'
import * as renewalsApi from '../../data/renewals'
import * as mcpApi from '../../data/mcp'
import { normalizeKinds, type RenewalKind } from '../../../../shared/renewalKinds'
import type { RenewalCreateInput, RenewalPatch, RenewalRecord, RenewalSnapshot } from '../../../../shared/renewalApi'
import { shortDate } from '../../../../shared/renewalWarnings'

/** the sidebar badge listens for this; its own reload is cheaper than threading state up */
export const RENEWALS_CHANGED_EVENT = 'renewals-changed'

export type RenewalScope = 'all' | 'current'

const announce = (): void => {
  window.dispatchEvent(new CustomEvent(RENEWALS_CHANGED_EVENT))
}

export function useRenewals(scope: RenewalScope) {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const { toast } = useToast()
  const report = useFailureReport()
  const [records, setRecords] = useState<RenewalRecord[]>([])
  const [kinds, setKinds] = useState<RenewalKind[]>(() => normalizeKinds(null))
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [list, stored] = await Promise.all([
        renewalsApi.list(scope === 'current' ? activeWorkspace : undefined),
        renewalsApi.kinds()
      ])
      if (list.ok) setRecords(list.value)
      else report('load the renewals', list.reason)
      if (stored.ok) setKinds(stored.value)
    } catch (err) {
      report('load the renewals', err)
    } finally {
      setLoading(false)
    }
  }, [scope, activeWorkspace, report])

  useEffect(() => { void load() }, [load])
  // the sweep moves dates on and lookups fill them in while the screen is open
  useEffect(() => mcpApi.onDataChanged(() => { void load() }), [load])

  const put = useCallback((record: RenewalRecord) => {
    setRecords(rs => (rs.some(r => r.id === record.id) ? rs.map(r => (r.id === record.id ? record : r)) : [...rs, record]))
    announce()
  }, [])

  const restore = useCallback(async (snapshot: RenewalSnapshot): Promise<void> => {
    try {
      const back = await renewalsApi.restore(snapshot)
      if (back.ok) put(back.value)
      else report('undo that', back.reason)
    } catch (err) {
      report('undo that', err)
    }
  }, [put, report])

  const create = useCallback(async (input: RenewalCreateInput): Promise<RenewalRecord | null> => {
    try {
      const created = await renewalsApi.create(input)
      if (!created.ok) {
        report('add it', created.reason)
        return null
      }
      put(created.value)
      return created.value
    } catch (err) {
      report('add it', err)
      return null
    }
  }, [put, report])

  /** true once saved, so an editor can stay open with its edits when it isn't */
  const save = useCallback(async (id: string, patch: RenewalPatch): Promise<boolean> => {
    try {
      const saved = await renewalsApi.update(id, patch)
      if (!saved.ok) {
        report('save the renewal', saved.reason)
        return false
      }
      put(saved.value)
      return true
    } catch (err) {
      report('save the renewal', err)
      return false
    }
  }, [put, report])

  const renew = useCallback(async (id: string, to: number | null = null): Promise<boolean> => {
    try {
      const result = await renewalsApi.renewed(id, to)
      if (!result.ok) {
        report('mark it renewed', result.reason)
        return false
      }
      const { record, previous } = result.value
      put(record)
      const pending = record.meta.history[0] && !record.meta.history[0].confirmed
      const until = record.meta.expiresAt === null ? '' : ` until ${shortDate(record.meta.expiresAt)}`
      toast(pending ? `Renewed${until}. Checking the registry to confirm` : `Renewed${until}`, {
        type: 'success',
        action: { label: 'Undo', onClick: () => { void restore(previous) } }
      })
      return true
    } catch (err) {
      report('mark it renewed', err)
      return false
    }
  }, [put, report, restore, toast])

  const remove = useCallback(async (record: RenewalRecord): Promise<void> => {
    try {
      const result = await renewalsApi.remove(record.id)
      if (!result.ok) {
        report('delete it', result.reason)
        return
      }
      setRecords(rs => rs.filter(r => r.id !== record.id))
      announce()
      const snapshot = result.value
      toast(`Deleted ${record.title}`, { action: { label: 'Undo', onClick: () => { void restore(snapshot) } } })
    } catch (err) {
      report('delete it', err)
    }
  }, [report, restore, toast])

  const snooze = useCallback(async (id: string, until: number | null): Promise<void> => {
    try {
      const result = await renewalsApi.snooze(id, until)
      if (result.ok) put(result.value)
      else report('snooze it', result.reason)
    } catch (err) {
      report('snooze it', err)
    }
  }, [put, report])

  const checkNow = useCallback(async (id: string): Promise<void> => {
    try {
      const result = await renewalsApi.checkNow(id)
      if (result.ok) put(result.value)
      else report('check the date', result.reason)
    } catch (err) {
      report('check the date', err)
    }
  }, [put, report])

  const saveKinds = useCallback(async (next: RenewalKind[]): Promise<boolean> => {
    try {
      const result = await renewalsApi.saveKinds(next)
      if (!result.ok) {
        report('save the kinds', result.reason)
        return false
      }
      setKinds(result.value)
      // a deleted kind moved its entries to Other
      await load()
      return true
    } catch (err) {
      report('save the kinds', err)
      return false
    }
  }, [load, report])

  const renameField = useCallback(async (kindId: string, fieldId: string, label: string, alsoEntries: boolean): Promise<boolean> => {
    try {
      const result = await renewalsApi.renameField(kindId, fieldId, label, alsoEntries)
      if (!result.ok) {
        report('rename the field', result.reason)
        return false
      }
      setKinds(result.value.kinds)
      if (result.value.renamed > 0) await load()
      return true
    } catch (err) {
      report('rename the field', err)
      return false
    }
  }, [load, report])

  return { records, kinds, loading, reload: load, create, save, renew, remove, snooze, checkNow, saveKinds, renameField }
}
