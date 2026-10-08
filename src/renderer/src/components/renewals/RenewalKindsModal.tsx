import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import ModalShell from '../ui/ModalShell'
import { WarnControl } from './RenewalFieldEditor'
import { KIND_ICON_COMPONENTS } from './kindIcon'
import { newField } from './renewalDraft'
import * as renewalsApi from '../../data/renewals'
import { describeCycle, FIELD_TYPES, normalizeWarnDays, type RenewalCycle, type RenewalField, type RenewalFieldType } from '../../../../shared/renewal'
import { KIND_ICONS, kindIdFor, withoutKind, type KindIcon, type RenewalKind } from '../../../../shared/renewalKinds'

interface Props {
  kinds: RenewalKind[]
  onClose: () => void
  onSave: (kinds: RenewalKind[]) => Promise<boolean>
  onRename: (kindId: string, fieldId: string, label: string, alsoEntries: boolean) => Promise<boolean>
}

const CYCLES: RenewalCycle[] = ['once', { every: 1, unit: 'month' }, { every: 3, unit: 'month' }, { every: 1, unit: 'year' }, { every: 2, unit: 'year' }]
const cycleKey = (c: RenewalCycle): string => (c === 'once' ? 'once' : `${c.every}${c.unit}`)

interface PendingRename {
  kindId: string
  fieldId: string
  label: string
  uses: number
}

/** kinds and the fields each starts with; edits apply to new entries, renames can reach the old ones too */
export default function RenewalKindsModal({ kinds, onClose, onSave, onRename }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<RenewalKind[]>(kinds)
  const [selectedId, setSelectedId] = useState(kinds[0]?.id ?? 'other')
  const [pending, setPending] = useState<PendingRename | null>(null)
  const [saving, setSaving] = useState(false)
  const selected = draft.find(k => k.id === selectedId) ?? draft[0]

  const editKind = (next: Partial<RenewalKind>): void =>
    setDraft(ks => ks.map(k => (k.id === selected.id ? { ...k, ...next } : k)))
  const editField = (field: RenewalField): void =>
    editKind({ fields: selected.fields.map(f => (f.id === field.id ? field : f)) })

  /** a template field already in use asks before its new name reaches the entries */
  const labelSettled = async (field: RenewalField): Promise<void> => {
    const saved = kinds.find(k => k.id === selected.id)?.fields.find(f => f.id === field.id)
    if (!saved || saved.label === field.label.trim() || !field.label.trim()) return
    const uses = await renewalsApi.fieldUses(field.id)
    if (uses.ok && uses.value > 0) setPending({ kindId: selected.id, fieldId: field.id, label: field.label.trim(), uses: uses.value })
  }

  const addKind = (): void => {
    const id = kindIdFor('New kind', draft)
    setDraft(ks => [...ks, { id, name: 'New kind', icon: 'calendar', builtIn: false, lookupSource: null, renews: 'manual', cycle: 'once', warnAt: [7, 1], fields: [] }])
    setSelectedId(id)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      if (await onSave(draft)) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell label="Renewal kinds" onClose={onClose} width="760px">
      <div className="row-between">
        <h2 className="heading-sm-bold" style={{ margin: 0 }}>Kinds and their fields</h2>
        <span className="text-caption-faint">Changes apply to new entries. Renaming a field can update existing ones too.</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 'var(--space-4)', minHeight: '360px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }} role="list">
          {draft.map(k => {
            const Icon = KIND_ICON_COMPONENTS[k.icon]
            return (
              <button key={k.id} type="button" role="listitem" className="renewal-filter" aria-pressed={k.id === selected.id}
                onClick={() => { setSelectedId(k.id); setPending(null) }}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderRadius: 'var(--radius-md)', textAlign: 'left' }}>
                <Icon size={14} aria-hidden="true" />
                <span className="truncate">{k.name}</span>
              </button>
            )
          })}
          <button type="button" className="btn-ghost" onClick={addKind} style={{ alignSelf: 'flex-start' }}>
            <span className="row-4px"><Plus size={14} aria-hidden="true" />New kind</span>
          </button>
        </div>

        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <span className="row-6px">
              <input className="input-sm" aria-label="Kind name" value={selected.name} maxLength={40}
                onChange={e => editKind({ name: e.target.value })} style={{ flex: 1, fontWeight: 'var(--weight-semibold)' }} />
              {!selected.builtIn && (
                <button type="button" className="btn-ghost hover-text-error" title="Delete this kind; its entries become Other"
                  onClick={() => { setDraft(ks => withoutKind(ks, selected.id)); setSelectedId('other') }}>
                  <span className="row-4px"><Trash2 size={14} aria-hidden="true" />Delete kind</span>
                </button>
              )}
            </span>

            <span className="row-wrap-6px" role="radiogroup" aria-label="Icon">
              {KIND_ICONS.map(icon => {
                const Icon = KIND_ICON_COMPONENTS[icon as KindIcon]
                return (
                  <button key={icon} type="button" role="radio" aria-checked={selected.icon === icon} aria-label={icon}
                    className="renewal-filter" aria-pressed={selected.icon === icon} onClick={() => editKind({ icon })}
                    style={{ padding: 'var(--space-1-5)' }}>
                    <Icon size={14} aria-hidden="true" />
                  </button>
                )
              })}
            </span>

            <div className="grid-2" style={{ gap: 'var(--space-3)' }}>
              <label className="col-sm text-xs">
                <span className="label-caps">Renews</span>
                <select className="select-sm" value={selected.renews} onChange={e => editKind({ renews: e.target.value === 'auto' ? 'auto' : 'manual' })}>
                  <option value="manual">By hand</option>
                  <option value="auto">By itself</option>
                </select>
              </label>
              <label className="col-sm text-xs">
                <span className="label-caps">Repeats</span>
                <select className="select-sm" value={cycleKey(selected.cycle)}
                  onChange={e => editKind({ cycle: CYCLES.find(c => cycleKey(c) === e.target.value) ?? 'once' })}>
                  {!CYCLES.some(c => cycleKey(c) === cycleKey(selected.cycle)) && <option value={cycleKey(selected.cycle)}>{describeCycle(selected.cycle)}</option>}
                  {CYCLES.map(c => <option key={cycleKey(c)} value={cycleKey(c)}>{describeCycle(c)}</option>)}
                </select>
              </label>
              <label className="col-sm text-xs">
                <span className="label-caps">Warn, days before</span>
                <input className="input-sm" defaultValue={selected.warnAt.join(', ')} key={`${selected.id}-warn`}
                  onBlur={e => editKind({ warnAt: normalizeWarnDays(e.target.value.split(/[,\s]+/).filter(Boolean).map(Number)) })} />
              </label>
            </div>

            <span className="label-caps">Starting fields</span>
            {selected.fields.length === 0 && <span className="text-caption-faint">None yet. Entries of this kind start with no fields.</span>}
            {selected.fields.map(field => (
              <div key={field.id} className="row-6px" style={{ alignItems: 'flex-start' }}>
                <input className="input-sm" aria-label="Field name" value={field.label} maxLength={40} style={{ width: '160px' }}
                  onChange={e => editField({ ...field, label: e.target.value })}
                  onBlur={() => { void labelSettled(field) }} />
                <span className="renewal-chip" style={{ marginTop: 'var(--space-1-5)' }}>{FIELD_TYPES.find(t => t.id === field.type)?.label}</span>
                <span className="flex-1">
                  {field.type === 'date' && <WarnControl warn={field.warn} label={field.label} onChange={warn => editField({ ...field, warn })} />}
                  {field.type === 'checkbox' && (
                    <label className="row-6px text-caption-faint">
                      <input type="checkbox" checked={field.clearOnRenewal} onChange={e => editField({ ...field, clearOnRenewal: e.target.checked })} />
                      Clear on each renewal
                    </label>
                  )}
                </span>
                <button type="button" className="btn-ghost" aria-label={`Remove ${field.label}`} title="Remove from the template"
                  onClick={() => editKind({ fields: selected.fields.filter(f => f.id !== field.id) })}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
            {pending && pending.kindId === selected.id && (
              <div className="renewal-note renewal-note-info" role="alert">
                <span className="flex-1">
                  {pending.uses === 1 ? '1 entry uses' : `${pending.uses} entries use`} this field. Rename it there too?
                  <span className="row-6px" style={{ marginTop: 'var(--space-1-5)' }}>
                    <button type="button" className="btn-secondary" onClick={() => { void onRename(pending.kindId, pending.fieldId, pending.label, true); setPending(null) }}>
                      Rename on {pending.uses === 1 ? 'it' : `all ${pending.uses}`} too
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => { void onRename(pending.kindId, pending.fieldId, pending.label, false); setPending(null) }}>
                      Only the template
                    </button>
                  </span>
                </span>
              </div>
            )}
            <select className="select-sm" aria-label="Add a starting field" value="" style={{ alignSelf: 'flex-start', flex: '0 0 auto' }}
              onChange={e => {
                if (!e.target.value) return
                editKind({ fields: [...selected.fields, newField(e.target.value as RenewalFieldType, crypto.randomUUID())] })
              }}>
              <option value="">+ Add a starting field</option>
              {FIELD_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="row-between">
        <span className="text-caption-faint">Domain and Certificate check their own dates, so they can be renamed but not deleted.</span>
        <span className="row-6px">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => { void save() }}>{saving ? 'Saving' : 'Save kinds'}</button>
        </span>
      </div>
    </ModalShell>
  )
}
