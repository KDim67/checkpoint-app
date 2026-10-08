import React, { useState } from 'react'
import { BookmarkPlus, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react'
import RenewalMenu from './RenewalMenu'
import DueDateField from '../ui/DueDateField'
import { allDay, dueDay } from '../../../../shared/dueDate'
import {
  currencyDigits,
  keyHintOf,
  normalizeMoney,
  normalizeWarnDays,
  parseAmount,
  RENEWAL_LIMITS,
  safeLink,
  type DateWarn,
  type RenewalField
} from '../../../../shared/renewal'

interface Props {
  field: RenewalField
  defaultCurrency: string
  onChange: (field: RenewalField) => void
  onRemove: () => void
  /** absent when the entry's kind has no template to save into */
  onSaveToTemplate?: () => void
  onOpenLink: (url: string) => void
}

const pad = (n: number): string => String(n).padStart(2, '0')

const monthValue = (ms: number | null): string => {
  if (ms === null) return ''
  const d = dueDay(ms)
  return `${d.year}-${pad(d.month + 1)}`
}

const fromMonth = (value: string): number | null => {
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  return m ? allDay({ year: Number(m[1]), month: Number(m[2]) - 1, day: 1 }) : null
}

const daysText = (days: number[]): string => days.join(', ')

/** a money field's amount as typed, kept apart from the stored cents until it reads as an amount */
function MoneyInput({ field, defaultCurrency, onChange }: { field: Extract<RenewalField, { type: 'money' }>; defaultCurrency: string; onChange: Props['onChange'] }) {
  const currency = field.value?.currency ?? defaultCurrency
  const shown = field.value ? (field.value.amount / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency)) : ''
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (amountText: string, code: string): void => {
    setDraft(null)
    if (!amountText.trim()) { onChange({ ...field, value: null }); return }
    const amount = parseAmount(amountText, code)
    if (amount === null) return
    const value = normalizeMoney({ amount, currency: code })
    if (value) onChange({ ...field, value })
  }
  const invalid = draft !== null && draft.trim() !== '' && parseAmount(draft, currency) === null
  return (
    <span className="row-6px">
      <input
        className="input-sm"
        inputMode="decimal"
        aria-label={`${field.label} amount`}
        aria-invalid={invalid}
        value={draft ?? shown}
        placeholder="0.00"
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== null) commit(draft, currency) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={{ flex: 1, minWidth: 0, borderColor: invalid ? 'var(--color-error)' : undefined }}
      />
      <input
        className="input-sm"
        aria-label={`${field.label} currency`}
        value={currency}
        maxLength={3}
        onChange={e => {
          const code = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')
          if (code.length === 3 && field.value) onChange({ ...field, value: { ...field.value, currency: code } })
          else if (code.length === 3) commit(draft ?? shown, code)
        }}
        style={{ width: '56px', textTransform: 'uppercase' }}
      />
    </span>
  )
}

export function WarnControl({ warn, onChange, label }: { warn: DateWarn; onChange: (warn: DateWarn) => void; label: string }) {
  const [days, setDays] = useState(warn.mode === 'before' ? daysText(warn.days) : '30')
  return (
    <span className="row-6px">
      <select
        className="select-sm"
        aria-label={`When to warn about ${label}`}
        value={warn.mode}
        onChange={e => {
          const mode = e.target.value
          if (mode === 'before') onChange({ mode: 'before', days: normalizeWarnDays(days.split(/[,\s]+/).map(Number)) })
          else onChange(mode === 'beforeRenewal' ? { mode: 'beforeRenewal' } : { mode: 'none' })
        }}
      >
        <option value="none">No warning</option>
        <option value="before">Warn days before</option>
        <option value="beforeRenewal">Warn if it ends before the renewal</option>
      </select>
      {warn.mode === 'before' && (
        <input
          className="input-sm"
          aria-label={`Days before ${label} to warn`}
          value={days}
          onChange={e => setDays(e.target.value)}
          onBlur={() => {
            const next = normalizeWarnDays(days.split(/[,\s]+/).filter(Boolean).map(Number))
            setDays(daysText(next))
            onChange(next.length ? { mode: 'before', days: next } : { mode: 'none' })
          }}
          style={{ width: '88px' }}
        />
      )}
    </span>
  )
}

export default function RenewalFieldEditor({ field, defaultCurrency, onChange, onRemove, onSaveToTemplate, onOpenLink }: Props): React.JSX.Element {
  const [trimmed, setTrimmed] = useState(false)

  let control: React.ReactNode
  switch (field.type) {
    case 'text':
      control = (
        <input className="input-sm" aria-label={field.label} value={field.value} maxLength={RENEWAL_LIMITS.text}
          onChange={e => onChange({ ...field, value: e.target.value })} style={{ width: '100%' }} />
      )
      break
    case 'number':
      control = (
        <input className="input-sm" type="number" aria-label={field.label} value={field.value ?? ''}
          onChange={e => onChange({ ...field, value: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: '100%' }} />
      )
      break
    case 'money':
      control = <MoneyInput field={field} defaultCurrency={defaultCurrency} onChange={onChange} />
      break
    case 'date':
      control = (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
          <span className="row-6px">
            <select className="select-sm" aria-label={`${field.label} precision`} value={field.precision} style={{ flex: '0 0 auto' }}
              onChange={e => onChange({ ...field, precision: e.target.value === 'month' ? 'month' : 'day', value: field.value })}>
              <option value="day">Day</option>
              <option value="month">Month</option>
            </select>
            {field.precision === 'month'
              ? <input className="input-sm" type="month" aria-label={field.label} value={monthValue(field.value)}
                  onChange={e => onChange({ ...field, value: fromMonth(e.target.value) })} style={{ flex: 1 }} />
              : <DueDateField value={field.value} onChange={value => onChange({ ...field, value })} />}
          </span>
          <WarnControl warn={field.warn} label={field.label} onChange={warn => onChange({ ...field, warn })} />
        </span>
      )
      break
    case 'checkbox':
      control = (
        <span className="row-8px">
          <label className="row-6px text-xs">
            <input type="checkbox" checked={field.value} onChange={e => onChange({ ...field, value: e.target.checked })} />
            {field.value ? 'Yes' : 'No'}
          </label>
          <label className="row-6px text-caption-faint">
            <input type="checkbox" checked={field.clearOnRenewal} onChange={e => onChange({ ...field, clearOnRenewal: e.target.checked })} />
            Clear on each renewal
          </label>
        </span>
      )
      break
    case 'link':
      control = (
        <span className="row-6px">
          <input className="input-sm" aria-label={field.label} value={field.value} placeholder="https://"
            onChange={e => onChange({ ...field, value: e.target.value })}
            onBlur={() => onChange({ ...field, value: safeLink(field.value) })} style={{ flex: 1, minWidth: 0 }} />
          {safeLink(field.value) && (
            <button type="button" className="btn-ghost" aria-label={`Open ${field.label}`} title={`Open ${field.label}`} onClick={() => onOpenLink(field.value)}>
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          )}
        </span>
      )
      break
    case 'keyHint':
      control = (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <input className="input-sm mono" aria-label={field.label} value={field.value} placeholder="last 4 characters"
            onChange={e => {
              const raw = e.target.value
              setTrimmed(raw.trim().length > RENEWAL_LIMITS.hint)
              onChange({ ...field, value: keyHintOf(raw) })
            }} style={{ width: '120px' }} />
          <span className="text-caption-faint" aria-live="polite">
            {trimmed ? 'Only the last 4 characters were kept. The key itself stays in your password manager.' : 'Enough to tell keys apart, never the key.'}
          </span>
        </span>
      )
      break
  }

  return (
    <div className="renewal-field">
      <input
        className="input-sm"
        aria-label="Field name"
        value={field.label}
        maxLength={RENEWAL_LIMITS.label}
        onChange={e => onChange({ ...field, label: e.target.value })}
        onBlur={() => { if (!field.label.trim()) onChange({ ...field, label: 'Field' }) }}
        style={{ fontWeight: 'var(--weight-semibold)', background: 'transparent', border: '1px solid transparent', padding: 'var(--space-1) 0' }}
      />
      <RenewalMenu
        label={`Options for ${field.label}`}
        trigger={<MoreHorizontal size={14} aria-hidden="true" />}
        entries={[
          ...(onSaveToTemplate ? [{ label: 'Save to template', icon: <BookmarkPlus size={14} />, onSelect: onSaveToTemplate }] : []),
          { label: 'Remove field', icon: <Trash2 size={14} />, onSelect: onRemove }
        ]}
      />
      <div style={{ gridColumn: '1 / -1' }}>{control}</div>
    </div>
  )
}
