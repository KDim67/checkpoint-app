import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import DrawerCloseButton from '../ui/DrawerCloseButton'
import DetailTitleInput from '../ui/DetailTitleInput'
import DueDateField from '../ui/DueDateField'
import RenewalFieldEditor from './RenewalFieldEditor'
import { KindIconView } from './kindIcon'
import { lookupWords } from './RenewalRow'
import { cutSecret, findSecret, newField, type RenewalDraft } from './renewalDraft'
import { dueDay, formatDueDate } from '../../../../shared/dueDate'
import {
  describeCycle,
  expiryPhrase,
  FIELD_TYPES,
  normalizeWarnDays,
  safeLink,
  type RenewalCycle,
  type RenewalField,
  type RenewalFieldType
} from '../../../../shared/renewal'
import { kindById, type RenewalKind } from '../../../../shared/renewalKinds'
import { normalizeHost } from '../../../../shared/renewalText'
import type { RenewalPatch, RenewalRecord } from '../../../../shared/renewalApi'

interface Props {
  record: RenewalRecord
  kinds: RenewalKind[]
  workspaces: string[]
  defaultCurrency: string
  now: number
  onSave: (patch: RenewalPatch) => Promise<boolean>
  onClose: () => void
  onRenew: (to: number | null) => void
  onCheckNow: () => void
  /** the template field id the entry's field now points at, or null when it couldn't be saved */
  onSaveToTemplate: (kindId: string, field: RenewalField) => Promise<string | null>
  onDelete: () => void
  onOpenLink: (url: string) => void
}

const CYCLE_CHOICES: { id: string; cycle: RenewalCycle }[] = [
  { id: 'once', cycle: 'once' },
  { id: '1m', cycle: { every: 1, unit: 'month' } },
  { id: '3m', cycle: { every: 3, unit: 'month' } },
  { id: '6m', cycle: { every: 6, unit: 'month' } },
  { id: '1y', cycle: { every: 1, unit: 'year' } },
  { id: '2y', cycle: { every: 2, unit: 'year' } },
  { id: '3y', cycle: { every: 3, unit: 'year' } },
  { id: '5y', cycle: { every: 5, unit: 'year' } },
  { id: '10y', cycle: { every: 10, unit: 'year' } }
]

const cycleId = (cycle: RenewalCycle): string =>
  cycle === 'once' ? 'once' : `${cycle.every}${cycle.unit === 'year' ? 'y' : 'm'}`

const draftOf = (record: RenewalRecord): RenewalDraft => ({
  title: record.title,
  body: record.body,
  context: record.context,
  meta: record.meta
})

const newId = (): string => crypto.randomUUID()

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
      <span className="label-caps">{label}</span>
      {children}
    </div>
  )
}

export default function RenewalEditor({
  record, kinds, workspaces, defaultCurrency, now,
  onSave, onClose, onRenew, onCheckNow, onSaveToTemplate, onDelete, onOpenLink
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<RenewalDraft>(() => draftOf(record))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [warnText, setWarnText] = useState(record.meta.warnAt.join(', '))
  const [dismissed, setDismissed] = useState<string[]>([])
  const [renewTo, setRenewTo] = useState<number | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // a lookup or the sweep can change it while it's open; an unsaved edit wins over that
  useEffect(() => {
    if (dirty) return
    setDraft(draftOf(record))
    setWarnText(record.meta.warnAt.join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.updatedAt, record.lookupState?.checkedAt])

  const kind = kindById(kinds, draft.meta.kind)
  const { meta } = draft
  const edit = (next: Partial<RenewalDraft>): void => {
    setDraft(d => ({ ...d, ...next }))
    setDirty(true)
  }
  const editMeta = (next: Partial<RenewalDraft['meta']>): void => edit({ meta: { ...draft.meta, ...next } })
  const editField = (field: RenewalField): void =>
    editMeta({ fields: meta.fields.map(f => (f.id === field.id ? field : f)) })

  const save = async (): Promise<boolean> => {
    if (!dirty) return true
    if (!draft.title.trim()) {
      titleRef.current?.focus()
      return false
    }
    setSaving(true)
    try {
      const ok = await onSave({ title: draft.title, body: draft.body, context: draft.context, meta: draft.meta })
      if (ok) setDirty(false)
      return ok
    } finally {
      setSaving(false)
    }
  }

  // closing saves first; a failed save keeps the panel open with the edits
  const requestClose = async (): Promise<void> => {
    if (await save()) onClose()
  }

  const secret = findSecret(draft)
  const showSecret = secret && !dismissed.includes(secret.secret)
  const lookupSource = kind.lookupSource
  const lookupState = record.lookupState
  const words = lookupWords({ ...record, meta })

  return (
    <aside
      className="renewal-editor"
      aria-label={`Edit ${record.title}`}
      // a field that uses Escape for itself, a date being typed, says so by preventing it
      onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); void requestClose() } }}
    >
      <div className="row-between-gap" style={{ alignItems: 'flex-start' }}>
        <span className="renewal-kind-icon" style={{ marginTop: 'var(--space-1-5)' }}><KindIconView icon={kind.icon} /></span>
        <div className="flex-1 min-w-0">
          <DetailTitleInput
            inputRef={titleRef}
            id="renewal-title"
            value={draft.title}
            onChange={title => edit({ title })}
            placeholder="Name"
          />
          <span className="text-caption-faint">
            {record.status === 'cancelled' ? 'Cancelled, no warnings'
              : meta.expiresAt === null ? 'No expiry date yet'
              : `${expiryPhrase(meta.expiresAt, now)}, ${formatDueDate(meta.expiresAt)}`}
          </span>
        </div>
        <DrawerCloseButton onClick={() => { void requestClose() }} title={dirty ? 'Save and close' : 'Close'} />
      </div>

      {record.dropped > 0 && (
        <div className="renewal-note renewal-note-info" role="status">
          {record.dropped === 1 ? '1 field couldn’t be read and was left out.' : `${record.dropped} fields couldn’t be read and were left out.`}
        </div>
      )}

      {showSecret && secret && (
        <div className="renewal-note" role="alert">
          <AlertTriangle size={14} className="icon-warning" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span className="flex-1">
            This looks like a key. Notes sync to your other devices and the assistant can read them.
            <span className="row-6px" style={{ marginTop: 'var(--space-1-5)' }}>
              <button type="button" className="btn-secondary" onClick={() => edit(cutSecret(draft, secret.secret, secret.place, newId))}>
                Keep only the last 4
              </button>
              <button type="button" className="btn-ghost" onClick={() => setDismissed(d => [...d, secret.secret])}>
                It isn&rsquo;t a key
              </button>
            </span>
          </span>
        </div>
      )}

      <Section label="Expires">
        <DueDateField
          value={meta.expiresAt}
          onChange={expiresAt => editMeta({ expiresAt, anchorDay: expiresAt === null ? meta.anchorDay : dueDay(expiresAt).day })}
        />
        {record.status !== 'cancelled' && meta.expiresAt !== null && (
          meta.cycle === 'once'
            ? (
              <span className="row-6px">
                <DueDateField value={renewTo} onChange={setRenewTo} />
                <button type="button" className="btn-secondary" disabled={renewTo === null || dirty}
                  title={dirty ? 'Save your changes first' : 'Set the new expiry date'}
                  onClick={() => { onRenew(renewTo); setRenewTo(null) }}>
                  <span className="row-4px"><Check size={14} aria-hidden="true" />Renewed</span>
                </button>
              </span>
            )
            : (
              <button type="button" className="btn-secondary" disabled={dirty} style={{ alignSelf: 'flex-start' }}
                title={dirty ? 'Save your changes first' : `Move it on ${describeCycle(meta.cycle).toLowerCase()}`}
                onClick={() => onRenew(null)}>
                <span className="row-4px"><Check size={14} aria-hidden="true" />Renewed</span>
              </button>
            )
        )}
      </Section>

      <div className="grid-2" style={{ gap: 'var(--space-3)' }}>
        <Section label="Kind">
          <select className="select-sm" value={meta.kind} onChange={e => editMeta({ kind: e.target.value })} aria-label="Kind">
            {kinds.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </Section>
        <Section label="Repeats">
          <select className="select-sm" aria-label="How often it renews" value={cycleId(meta.cycle)}
            onChange={e => editMeta({ cycle: CYCLE_CHOICES.find(c => c.id === e.target.value)?.cycle ?? 'once' })}>
            {!CYCLE_CHOICES.some(c => c.id === cycleId(meta.cycle)) && <option value={cycleId(meta.cycle)}>{describeCycle(meta.cycle)}</option>}
            {CYCLE_CHOICES.map(c => <option key={c.id} value={c.id}>{describeCycle(c.cycle)}</option>)}
          </select>
        </Section>
        <Section label="Renews">
          <span className="row-6px" role="radiogroup" aria-label="How it renews">
            {(['manual', 'auto'] as const).map(mode => (
              <button key={mode} type="button" role="radio" aria-checked={meta.renews === mode} className="renewal-filter"
                aria-pressed={meta.renews === mode} onClick={() => editMeta({ renews: mode })}>
                {mode === 'auto' ? 'By itself' : 'By hand'}
              </button>
            ))}
          </span>
        </Section>
        <Section label="Warn, days before">
          <input className="input-sm" aria-label="Days before to warn" value={warnText} placeholder="30, 7, 1"
            onChange={e => setWarnText(e.target.value)}
            onBlur={() => {
              const days = normalizeWarnDays(warnText.split(/[,\s]+/).filter(Boolean).map(Number))
              setWarnText(days.join(', '))
              if (days.join() !== meta.warnAt.join()) editMeta({ warnAt: days })
            }} />
        </Section>
      </div>

      {meta.renews === 'auto' && meta.cycle === 'once' && !meta.lookup && (
        <div className="renewal-note renewal-note-info">Something that renews by itself needs a repeat, or a domain or host to check. Until then it&rsquo;s treated as by hand.</div>
      )}

      {lookupSource && (
        <Section label={lookupSource === 'rdap' ? 'Check the date at the registry' : 'Check the site’s certificate'}>
          <span className="row-6px">
            <input className="input-sm" style={{ flex: 1, minWidth: 0 }}
              aria-label={lookupSource === 'rdap' ? 'Domain' : 'Host'}
              placeholder={lookupSource === 'rdap' ? 'acme.dev' : 'acme.dev or 10.0.0.5'}
              value={meta.lookup?.target ?? ''}
              onChange={e => {
                const target = e.target.value
                editMeta({ lookup: target.trim() ? { source: lookupSource, target, port: meta.lookup?.port ?? null, auto: meta.lookup?.auto ?? true } : null })
              }}
              onBlur={() => {
                if (lookupSource !== 'rdap' || !meta.lookup) return
                const host = normalizeHost(meta.lookup.target)
                if (host && host !== meta.lookup.target) editMeta({ lookup: { ...meta.lookup, target: host } })
              }} />
            {lookupSource === 'tls' && (
              <input className="input-sm" style={{ width: '72px' }} aria-label="Port" placeholder="443" inputMode="numeric"
                value={meta.lookup?.port ?? ''}
                onChange={e => meta.lookup && editMeta({ lookup: { ...meta.lookup, port: Number(e.target.value) || null } })} />
            )}
            <button type="button" className="btn-secondary" disabled={!record.meta.lookup || dirty}
              title={dirty ? 'Save your changes first' : 'Check now'} onClick={onCheckNow}>
              <span className="row-4px"><RefreshCw size={14} aria-hidden="true" />Check</span>
            </button>
          </span>
          {meta.lookup && (
            <label className="row-6px text-caption-faint">
              <input type="checkbox" checked={meta.lookup.auto} onChange={e => meta.lookup && editMeta({ lookup: { ...meta.lookup, auto: e.target.checked } })} />
              Check automatically
            </label>
          )}
          {words && <span className="text-xs">{words}{lookupState?.detail ? `. ${lookupState.detail}` : ''}</span>}
          {lookupState?.disagree && (
            <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start' }}
              onClick={() => editMeta({ expiresAt: lookupState.disagree, anchorDay: dueDay(lookupState.disagree as number).day })}>
              Use {formatDueDate(lookupState.disagree)}
            </button>
          )}
          <span className="text-caption-faint">
            Only the {lookupSource === 'rdap' ? 'domain name goes to the public registry' : 'host name is used, to connect to the site'}; nothing else leaves this computer.
          </span>
        </Section>
      )}

      <Section label="Renew page">
        <span className="row-6px">
          <input className="input-sm" style={{ flex: 1, minWidth: 0 }} aria-label="Renew page" placeholder="https://"
            value={meta.url} onChange={e => editMeta({ url: e.target.value })}
            onBlur={() => { if (meta.url !== safeLink(meta.url)) editMeta({ url: safeLink(meta.url) }) }} />
          {safeLink(meta.url) && (
            <button type="button" className="btn-ghost" aria-label="Open the renew page" title="Open the renew page" onClick={() => onOpenLink(meta.url)}>
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          )}
        </span>
      </Section>

      <Section label="Fields">
        {meta.fields.length === 0 && <span className="text-caption-faint">Add what you want to keep an eye on: a cost, the card that pays it, who owns it.</span>}
        {meta.fields.map(field => (
          <RenewalFieldEditor
            key={field.id}
            field={field}
            defaultCurrency={defaultCurrency}
            onChange={editField}
            onRemove={() => editMeta({ fields: meta.fields.filter(f => f.id !== field.id) })}
            onOpenLink={onOpenLink}
            onSaveToTemplate={async () => {
              const templateFieldId = await onSaveToTemplate(meta.kind, field)
              if (templateFieldId) editField({ ...field, templateFieldId })
            }}
          />
        ))}
        <select className="select-sm" aria-label="Add a field" value=""
          onChange={e => {
            if (!e.target.value) return
            editMeta({ fields: [...meta.fields, newField(e.target.value as RenewalFieldType, newId())] })
          }}>
          <option value="">+ Add a field</option>
          {FIELD_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Section>

      <Section label="Notes">
        <textarea className="input-sm" rows={3} aria-label="Notes" value={draft.body}
          placeholder="Where the key lives, who to ask, what to do"
          onChange={e => edit({ body: e.target.value })} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
      </Section>

      {workspaces.length > 1 && (
        <Section label="Workspace">
          <select className="select-sm" aria-label="Workspace" value={draft.context} onChange={e => edit({ context: e.target.value })}>
            {workspaces.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </Section>
      )}

      {meta.history.length > 0 && (
        <Section label="History">
          {meta.history.slice(0, 5).map(h => (
            <span key={`${h.at}-${h.to}`} className="text-caption-faint">
              {formatDueDate(h.at)}: {h.from === null ? '' : `${formatDueDate(h.from)} to `}{formatDueDate(h.to)}
              {h.by === 'auto' ? ', by itself' : h.by === 'registry' ? ', seen at the registry' : ''}
              {h.by === 'you' && meta.lookup ? (h.confirmed ? ', confirmed' : ', not confirmed yet') : ''}
            </span>
          ))}
        </Section>
      )}

      <div className="row-between" style={{ marginTop: 'auto', paddingTop: 'var(--space-2)' }}>
        <button type="button" className="btn-ghost hover-text-error" onClick={onDelete}>
          <span className="row-4px"><Trash2 size={14} aria-hidden="true" />Delete</span>
        </button>
        <span className="row-6px">
          {dirty && (
            <button type="button" className="btn-secondary" onClick={() => { setDraft(draftOf(record)); setWarnText(record.meta.warnAt.join(', ')); setDirty(false) }}>
              Discard
            </button>
          )}
          <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={() => { void save() }}>
            {saving ? 'Saving' : dirty ? 'Save' : 'Saved'}
          </button>
        </span>
      </div>
    </aside>
  )
}
