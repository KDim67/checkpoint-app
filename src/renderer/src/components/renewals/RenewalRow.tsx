import React from 'react'
import { BellOff, Check, ExternalLink, MoreHorizontal, Pencil, RotateCcw, Trash2, XCircle } from 'lucide-react'
import RenewalMenu from './RenewalMenu'
import { KindIconView } from './kindIcon'
import { expiryPhrase, formatMoney, isExpired, isInWarningWindow } from '../../../../shared/renewal'
import { formatDueDate } from '../../../../shared/dueDate'
import { shortDate } from '../../../../shared/renewalWarnings'
import { pendingRenewal } from '../../../../shared/renewalTrust'
import type { RenewalKind } from '../../../../shared/renewalKinds'
import type { RenewalRecord } from '../../../../shared/renewalApi'

interface Props {
  record: RenewalRecord
  kind: RenewalKind
  now: number
  selected: boolean
  /** the one row Tab lands on */
  tabStop: boolean
  showWorkspace: boolean
  rowRef?: (el: HTMLDivElement | null) => void
  onSelect: () => void
  onOpen: () => void
  onRenew: () => void
  onSnooze: (until: number | null) => void
  onOpenLink: (url: string) => void
  onToggleCancelled: () => void
  onDelete: () => void
}

/** what the last lookup says, in words; nothing when there is no lookup */
export function lookupWords(record: RenewalRecord): string | null {
  const { meta, lookupState: state } = record
  if (!meta.lookup) return null
  if (state?.disagree) return `Registry says ${shortDate(state.disagree)}`
  if (pendingRenewal(meta)) return meta.lookup.source === 'rdap' ? 'Waiting for the registry to confirm' : 'Waiting for the new certificate'
  if (!state) return 'Not checked yet'
  if (state.state === 'unsupported') return 'Can’t be checked automatically'
  if (state.state === 'error') return 'Couldn’t check'
  if (state.verified === false) return 'Certificate not trusted'
  return meta.lookup.source === 'rdap' ? 'Matches the registry' : 'Matches the certificate'
}

const tomorrowMorning = (now: number, days: number): number => {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

export default function RenewalRow({
  record, kind, now, selected, tabStop, showWorkspace, rowRef,
  onSelect, onOpen, onRenew, onSnooze, onOpenLink, onToggleCancelled, onDelete
}: Props): React.JSX.Element {
  const { meta } = record
  const cancelled = record.status === 'cancelled'
  const severity = cancelled || meta.expiresAt === null ? 'none'
    : isExpired(meta.expiresAt, now) ? 'expired'
    : isInWarningWindow(meta, now) ? 'warning' : 'none'
  const money = meta.fields.find(f => f.type === 'money' && f.value)
  const lookup = lookupWords(record)
  const details = [
    kind.name,
    money && money.type === 'money' && money.value ? `${formatMoney(money.value.amount, money.value.currency)}` : null,
    lookup,
    record.snoozedUntil ? `Snoozed until ${shortDate(record.snoozedUntil)}` : null
  ].filter(Boolean).join(' · ')

  return (
    <div
      ref={rowRef}
      role="listitem"
      data-selected={selected}
      data-renewal-id={record.id}
      aria-label={`${record.title}, ${cancelled ? 'cancelled' : meta.expiresAt === null ? 'no date yet' : expiryPhrase(meta.expiresAt, now)}`}
      tabIndex={tabStop ? 0 : -1}
      className="renewal-row"
      data-severity={severity}
      onClick={() => { onSelect(); onOpen() }}
      onFocus={onSelect}
      style={cancelled ? { opacity: 0.6 } : undefined}
    >
      <span className="renewal-stripe" aria-hidden="true" />
      <span className="renewal-kind-icon"><KindIconView icon={kind.icon} /></span>
      <span className="min-w-0" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-0-5)' }}>
        <span className="row-6px min-w-0">
          <span className="truncate text-item-strong">{record.title}</span>
          {showWorkspace && <span className="renewal-chip">{record.context}</span>}
        </span>
        <span className="truncate text-caption-faint">{details}</span>
      </span>
      <span className="renewal-when" title={meta.expiresAt === null ? undefined : formatDueDate(meta.expiresAt)}>
        {cancelled ? 'Cancelled' : meta.expiresAt === null ? 'No date yet' : expiryPhrase(meta.expiresAt, now)}
      </span>
      <span className="renewal-actions">
        <span className="renewal-chip">{meta.renews === 'auto' ? 'Auto' : 'Manual'}</span>
        {!cancelled && meta.expiresAt !== null && (
          <button
            type="button"
            className="btn-ghost"
            onClick={e => { e.stopPropagation(); onRenew() }}
            title="Mark it renewed and move the date on"
          >
            <span className="row-4px"><Check size={14} aria-hidden="true" />Renewed</span>
          </button>
        )}
        {meta.url && (
          <button
            type="button"
            className="btn-ghost"
            aria-label="Open the renew page"
            title="Open the renew page"
            onClick={e => { e.stopPropagation(); onOpenLink(meta.url) }}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        )}
        <RenewalMenu
          label={`More for ${record.title}`}
          trigger={<MoreHorizontal size={16} aria-hidden="true" />}
          entries={[
            { label: 'Edit', icon: <Pencil size={14} />, onSelect: onOpen },
            ...(record.snoozedUntil
              ? [{ label: 'Stop snoozing', icon: <BellOff size={14} />, onSelect: () => onSnooze(null) }]
              : [
                  { label: 'Snooze until tomorrow', icon: <BellOff size={14} />, onSelect: () => onSnooze(tomorrowMorning(now, 1)) },
                  { label: 'Snooze for 3 days', icon: <BellOff size={14} />, onSelect: () => onSnooze(tomorrowMorning(now, 3)) }
                ]),
            cancelled
              ? { label: 'Track it again', icon: <RotateCcw size={14} />, onSelect: onToggleCancelled }
              : { label: 'Cancel, stop warning', icon: <XCircle size={14} />, onSelect: onToggleCancelled },
            { label: 'Delete', icon: <Trash2 size={14} />, onSelect: onDelete }
          ]}
        />
      </span>
    </div>
  )
}
