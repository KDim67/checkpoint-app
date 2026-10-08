/** things that expire and come back: keys, subscriptions, domains, certificates and the user's own kinds */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronDown, ChevronRight, Search, Shapes } from 'lucide-react'
import EmptyState from './ui/EmptyState'
import RenewalRow from './renewals/RenewalRow'
import RenewalEditor from './renewals/RenewalEditor'
import RenewalKindsModal from './renewals/RenewalKindsModal'
import RenewalQuickAdd from './renewals/RenewalQuickAdd'
import { useRenewals, type RenewalScope } from './renewals/useRenewals'
import { guessCurrency, templateCopy } from './renewals/renewalDraft'
import { useAppStore } from '../store/appStore'
import { getEnumSetting, setStringSetting } from '../lib/settings'
import * as appApi from '../data/app'
import { dueDeadline } from '../../../shared/dueDate'
import { formatMoney, renewalGroup, renewalTotals, type RenewalField, type RenewalGroup } from '../../../shared/renewal'
import { kindById, newRenewalMeta } from '../../../shared/renewalKinds'
import type { RenewalGuess } from '../../../shared/renewalText'
import type { RenewalRecord } from '../../../shared/renewalApi'

const SCOPE_SETTING = 'renewals_scope'
const MINUTE = 60_000

const GROUPS: { id: RenewalGroup; label: string }[] = [
  { id: 'expired', label: 'Expired' },
  { id: 'soon', label: 'Next 30 days' },
  { id: 'later', label: 'Later' },
  { id: 'cancelled', label: 'Cancelled' }
]

const STARTERS: { kind: string; title: string }[] = [
  { kind: 'domain', title: 'New domain' },
  { kind: 'api_key', title: 'New API key' },
  { kind: 'subscription', title: 'New subscription' }
]

/** soonest first, no date last */
const byExpiry = (a: RenewalRecord, b: RenewalRecord): number => {
  const da = a.meta.expiresAt === null ? Infinity : dueDeadline(a.meta.expiresAt)
  const db = b.meta.expiresAt === null ? Infinity : dueDeadline(b.meta.expiresAt)
  return da - db || a.title.localeCompare(b.title)
}

export default function RenewalsView(): React.JSX.Element {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const availableWorkspaces = useAppStore(s => s.availableWorkspaces)
  const pendingCreate = useAppStore(s => s.pendingCreate)
  const setPendingCreate = useAppStore(s => s.setPendingCreate)
  const pendingRenewalId = useAppStore(s => s.pendingRenewalId)
  const setPendingRenewalId = useAppStore(s => s.setPendingRenewalId)

  const [scope, setScope] = useState<RenewalScope>('all')
  const renewals = useRenewals(scope)
  const { records, kinds, loading } = renewals
  const [now, setNow] = useState(() => Date.now())
  const [kindFilter, setKindFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const [showKinds, setShowKinds] = useState(false)
  const quickAddRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    getEnumSetting<RenewalScope>(SCOPE_SETTING, ['all', 'current'], 'all').then(setScope).catch(() => {})
  }, [])
  // "in 3 days" turns into "in 2 days" without a reload
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE)
    return () => clearInterval(timer)
  }, [])

  const changeScope = (next: RenewalScope): void => {
    setScope(next)
    void setStringSetting(SCOPE_SETTING, next)
  }

  // from the palette: New renewal lands in the box, a search hit opens its entry
  useEffect(() => {
    if (pendingCreate !== 'renewal') return
    setPendingCreate(null)
    quickAddRef.current?.focus()
  }, [pendingCreate, setPendingCreate])
  useEffect(() => {
    if (!pendingRenewalId || loading) return
    setPendingRenewalId(null)
    if (scope !== 'all' && !records.some(r => r.id === pendingRenewalId)) changeScope('all')
    setOpenId(pendingRenewalId)
    setSelectedId(pendingRenewalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRenewalId, loading])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return records.filter(r => {
      if (kindFilter && r.meta.kind !== kindFilter) return false
      if (!q) return true
      const text = [r.title, r.body, r.context, ...r.meta.fields.map(f => (f.type === 'text' ? f.value : ''))].join(' ').toLowerCase()
      return text.includes(q)
    })
  }, [records, kindFilter, query])

  const grouped = useMemo(() => {
    const out = new Map<RenewalGroup, RenewalRecord[]>(GROUPS.map(g => [g.id, []]))
    for (const r of visible) out.get(renewalGroup(r.status, r.meta, now))?.push(r)
    for (const list of out.values()) list.sort(byExpiry)
    return out
  }, [visible, now])

  // the order the arrow keys walk, cancelled only when it's showing
  const order = useMemo(
    () => GROUPS.flatMap(g => (g.id === 'cancelled' && !showCancelled ? [] : grouped.get(g.id) ?? [])),
    [grouped, showCancelled]
  )

  const totals = useMemo(() => renewalTotals(records), [records])
  const kindsInUse = useMemo(() => kinds.filter(k => records.some(r => r.meta.kind === k.id)), [kinds, records])
  const defaultCurrency = useMemo(() => guessCurrency(records), [records])
  const openRecord = records.find(r => r.id === openId) ?? null

  const openLink = useCallback((url: string) => { void appApi.openExternal(url) }, [])

  const add = async (guess: RenewalGuess): Promise<boolean> => {
    const kind = kindById(kinds, guess.kind)
    const meta = newRenewalMeta(kind, () => crypto.randomUUID())
    const created = await renewals.create({
      context: activeWorkspace,
      title: guess.title,
      meta: {
        ...meta,
        expiresAt: guess.expiresAt ?? null,
        lookup: guess.target && kind.lookupSource ? { source: kind.lookupSource, target: guess.target, port: null, auto: true } : null
      }
    })
    if (!created) return false
    setOpenId(created.id)
    setSelectedId(created.id)
    return true
  }

  const startWith = async (kindId: string, title: string): Promise<void> => {
    await add({ title, kind: kindId, expiresAt: undefined, target: null })
  }

  /** an entry's field into its kind's template, updating the one it came from if there is one */
  const saveToTemplate = async (kindId: string, field: RenewalField): Promise<string | null> => {
    const kind = kindById(kinds, kindId)
    const linked = field.templateFieldId && kind.fields.some(f => f.id === field.templateFieldId) ? field.templateFieldId : null
    const templateId = linked ?? crypto.randomUUID()
    const copy = templateCopy(field, templateId)
    const fields = linked ? kind.fields.map(f => (f.id === linked ? copy : f)) : [...kind.fields, copy]
    const ok = await renewals.saveKinds(kinds.map(k => (k.id === kind.id ? { ...k, fields } : k)))
    return ok ? templateId : null
  }

  const focusRow = (id: string | undefined): void => {
    if (!id) return
    setSelectedId(id)
    rowRefs.current.get(id)?.focus()
  }

  const onListKey = (e: React.KeyboardEvent): void => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, button')) return
    // the row the key was pressed on, which the selection may not have caught up with yet
    const current = target.closest<HTMLElement>('[data-renewal-id]')?.dataset.renewalId ?? selectedId
    const at = order.findIndex(r => r.id === current)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusRow(order[Math.min(order.length - 1, at + 1)]?.id)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusRow(order[Math.max(0, at - 1)]?.id)
        break
      case 'Home':
        e.preventDefault()
        focusRow(order[0]?.id)
        break
      case 'End':
        e.preventDefault()
        focusRow(order[order.length - 1]?.id)
        break
      case 'Enter':
        if (current) { e.preventDefault(); setOpenId(current) }
        break
      case 'Delete': {
        const record = order[at]
        if (!record) break
        e.preventDefault()
        if (openId === record.id) setOpenId(null)
        // the next row takes the focus, as in a file list
        const next = order[at + 1] ?? order[at - 1]
        void renewals.remove(record).then(() => focusRow(next?.id))
        break
      }
      case 'Escape':
        if (openId) { e.preventDefault(); setOpenId(null) }
        break
    }
  }

  // the first row is reachable by Tab before anything is selected
  const tabTarget = selectedId && order.some(r => r.id === selectedId) ? selectedId : order[0]?.id

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{
        flex: 1, minWidth: 0, padding: 'var(--space-5) var(--space-6) var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', boxSizing: 'border-box'
      }}>
        <div className="row-between" style={{ alignItems: 'flex-start', flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', margin: '0 0 var(--space-1) 0', color: 'var(--color-text-base)' }}>
              Renewals
            </h1>
            <span className="text-caption-faint">Keys, subscriptions, domains and anything else that expires, with a warning before it does.</span>
          </div>
          <span className="row-6px">
            <span className="row-4px" role="radiogroup" aria-label="Which workspaces">
              {(['all', 'current'] as const).map(s => (
                <button key={s} type="button" role="radio" aria-checked={scope === s} aria-pressed={scope === s}
                  className="renewal-filter" onClick={() => changeScope(s)}>
                  {s === 'all' ? 'All workspaces' : activeWorkspace}
                </button>
              ))}
            </span>
            <button type="button" className="btn-secondary" onClick={() => setShowKinds(true)}>
              <span className="row-4px"><Shapes size={14} aria-hidden="true" />Kinds</span>
            </button>
          </span>
        </div>

        <RenewalQuickAdd ref={quickAddRef} kinds={kinds} onAdd={add} />

        {totals.length > 0 && (
          <div className="renewal-totals" aria-label="What these cost">
            {totals.map(t => (
              <span key={t.key}>
                {t.label} <strong>{formatMoney(Math.round(t.monthly), t.currency)}</strong>/month · <strong>{formatMoney(Math.round(t.yearly), t.currency)}</strong>/year
              </span>
            ))}
          </div>
        )}

        {records.length > 0 && (
          <div className="row-wrap-6px" style={{ flexShrink: 0 }}>
            <button type="button" className="renewal-filter" aria-pressed={kindFilter === null} onClick={() => setKindFilter(null)}>All</button>
            {kindsInUse.map(k => (
              <button key={k.id} type="button" className="renewal-filter" aria-pressed={kindFilter === k.id}
                onClick={() => setKindFilter(f => (f === k.id ? null : k.id))}>
                {k.name}
              </button>
            ))}
            <span className="row-4px" style={{ marginLeft: 'auto' }}>
              <Search size={14} className="icon-faint" aria-hidden="true" />
              <input className="input-sm" type="search" aria-label="Search renewals" placeholder="Search" value={query}
                onChange={e => setQuery(e.target.value)} style={{ width: '180px' }} />
            </span>
          </div>
        )}

        {!loading && records.length === 0 ? (
          <div>
            <EmptyState
              icon={<CalendarClock size={48} />}
              title="Nothing expiring is tracked yet"
              description="Add an API key, a subscription or a domain, and you'll be warned before it runs out. Domains and certificates can find their own dates."
            />
            <div className="row-6px" style={{ justifyContent: 'center' }}>
              {STARTERS.map(s => (
                <button key={s.kind} type="button" className="btn-secondary" onClick={() => { void startWith(s.kind, s.title) }}>
                  {kindById(kinds, s.kind).name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="renewal-list" onKeyDown={onListKey}>
            {visible.length === 0 && !loading && <span className="text-empty">Nothing matches that.</span>}
            {GROUPS.map(group => {
              const list = grouped.get(group.id) ?? []
              if (list.length === 0) return null
              const collapsed = group.id === 'cancelled' && !showCancelled
              return (
                <section key={group.id} aria-label={group.label}>
                  <div className="renewal-group-head">
                    {group.id === 'cancelled' ? (
                      <button type="button" className="btn-ghost" aria-expanded={!collapsed} onClick={() => setShowCancelled(v => !v)}>
                        <span className="row-4px label-caps">
                          {collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                          {group.label} · {list.length}
                        </span>
                      </button>
                    ) : (
                      <span className="label-caps">{group.label} · {list.length}</span>
                    )}
                  </div>
                  {!collapsed && (
                    <div role="list">
                      {list.map(record => (
                        <RenewalRow
                          key={record.id}
                          record={record}
                          kind={kindById(kinds, record.meta.kind)}
                          now={now}
                          selected={record.id === selectedId || record.id === openId}
                          tabStop={record.id === tabTarget}
                          showWorkspace={scope === 'all' && availableWorkspaces.length > 1}
                          rowRef={el => { if (el) rowRefs.current.set(record.id, el); else rowRefs.current.delete(record.id) }}
                          onSelect={() => setSelectedId(record.id)}
                          onOpen={() => setOpenId(record.id)}
                          onRenew={() => {
                            // a one-off has no cycle to follow, so the editor asks for the date
                            if (record.meta.cycle === 'once') setOpenId(record.id)
                            else void renewals.renew(record.id)
                          }}
                          onSnooze={until => { void renewals.snooze(record.id, until) }}
                          onOpenLink={openLink}
                          onToggleCancelled={() => { void renewals.save(record.id, { status: record.status === 'cancelled' ? 'active' : 'cancelled' }) }}
                          onDelete={() => {
                            if (openId === record.id) setOpenId(null)
                            void renewals.remove(record)
                          }}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      {openRecord && (
        <RenewalEditor
          key={openRecord.id}
          record={openRecord}
          kinds={kinds}
          workspaces={availableWorkspaces}
          defaultCurrency={defaultCurrency}
          now={now}
          onSave={patch => renewals.save(openRecord.id, patch)}
          onClose={() => { setOpenId(null); focusRow(openRecord.id) }}
          onRenew={to => { void renewals.renew(openRecord.id, to) }}
          onCheckNow={() => { void renewals.checkNow(openRecord.id) }}
          onSaveToTemplate={saveToTemplate}
          onDelete={() => { setOpenId(null); void renewals.remove(openRecord) }}
          onOpenLink={openLink}
        />
      )}

      {showKinds && (
        <RenewalKindsModal
          kinds={kinds}
          onClose={() => setShowKinds(false)}
          onSave={renewals.saveKinds}
          onRename={renewals.renameField}
        />
      )}
    </div>
  )
}
