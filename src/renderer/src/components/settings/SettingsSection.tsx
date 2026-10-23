import React from 'react'
import Skeleton, { LoadingRegion } from '../ui/Skeleton'

/** passes FieldRow's ids down so its label and hint reach the control without threading ids */
const FieldContext = React.createContext<{ id: string; hintId?: string } | undefined>(undefined)

/** not exported: components only, or hot reload breaks */
function useField(explicitId?: string): { id?: string; hintId?: string } {
  const field = React.useContext(FieldContext)
  return { id: explicitId ?? field?.id, hintId: field?.hintId }
}

interface SettingsSectionProps {
  icon: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
}

export default function SettingsSection({
  icon,
  title,
  description,
  children
}: SettingsSectionProps) {
  return (
    // every card is a part of its section, for the jump links beside it
    <div data-settings-part={title} style={{
      background: 'var(--color-surface-1)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-lg)'
    }}>
      <div style={{
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--color-surface-offset)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        background: 'var(--color-surface-2)',
        // header paints its own background, so match the corners; overflow hidden would clip dropdowns
        borderTopLeftRadius: 'calc(var(--radius-lg) - 1px)',
        borderTopRightRadius: 'calc(var(--radius-lg) - 1px)'
      }}>
        <span aria-hidden="true" style={{ color: 'var(--color-secondary)', display: 'flex', flexShrink: 0 }}>
          {icon}
        </span>
        <div className="fill">
          {/* a real heading, the old divs gave screen readers no outline */}
          <h2 style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-bold)',
            color: 'var(--color-text-base)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            margin: 0
          }}>
            {title}
          </h2>
          {description && (
            <div className="text-sub">
              {description}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: 'var(--space-5)' }}>
        {children}
      </div>
    </div>
  )
}

export function FieldRow({
  label,
  hint,
  part,
  group = false,
  children
}: {
  label: string
  hint?: string
  /** starts a part of the section, named for its jump link */
  part?: string
  /** several controls or none, such as a row of choices: the label names the group instead of one control */
  group?: boolean
  children: React.ReactNode
}) {
  // the label used to be unassociated; the ids go through context so the control can claim them
  const fieldId = React.useId()
  const labelId = `${fieldId}-label`
  const hintId = `${fieldId}-hint`
  const field = React.useMemo(() => ({ id: fieldId, hintId: hint ? hintId : undefined }), [fieldId, hintId, hint])
  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--weight-semibold)',
    color: 'var(--color-text-muted)',
    width: 'fit-content'
  }

  return (
    <div
      className="col-1-5"
      data-settings-part={part}
      role={group ? 'group' : undefined}
      aria-labelledby={group ? labelId : undefined}
      aria-describedby={group && hint ? hintId : undefined}
    >
      {group ? (
        <span id={labelId} style={labelStyle}>{label}</span>
      ) : (
        <label id={labelId} htmlFor={fieldId} style={{ ...labelStyle, cursor: 'pointer' }}>{label}</label>
      )}
      <FieldContext.Provider value={group ? undefined : field}>
        {children}
      </FieldContext.Provider>
      {hint && (
        <span
          id={hintId}
          className="text-caption-faint"
        >
          {hint}
        </span>
      )}
    </div>
  )
}

/** a select that takes its FieldRow's label and hint */
export function SettingsSelect({
  id,
  className = 'select-md',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const field = useField(id)
  return <select id={field.id} aria-describedby={field.hintId} className={className} {...props} />
}

export function SettingsInput({
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
  id,
  min,
  max,
  step,
  inputMode,
  /** off for endpoints, model ids, keys, ports */
  spellCheck = false,
  ariaLabel
}: {
  value: string | number
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  type?: string
  id?: string
  min?: number
  max?: number
  step?: number
  inputMode?: 'text' | 'numeric' | 'decimal' | 'url' | 'email'
  spellCheck?: boolean
  ariaLabel?: string
}) {
  const field = useField(id)
  return (
    <input
      id={field.id}
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      inputMode={inputMode}
      spellCheck={spellCheck}
      // config, not credentials for a password manager
      autoComplete="off"
      aria-label={ariaLabel}
      aria-describedby={field.hintId}
      className="border-offset focus-border-primary"
      style={{
        background: 'var(--color-surface-2)',
        color: 'var(--color-text-base)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-2) var(--space-3)',
        fontSize: 'var(--text-sm)',
        width: '100%',
        fontFamily: 'var(--font-sans)',
        transition: 'border-color var(--duration-fast) var(--ease-default)'
        // no inline outline: none, it outranked the global :focus-visible ring
      }}
    />
  )
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  label,
  id,
  describedBy
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** the switch has no text, screen readers need this unless a label points at it */
  label?: string
  id?: string
  describedBy?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="settings-toggle"
    >
      <span className="settings-toggle-knob" aria-hidden="true" />
    </button>
  )
}

/** a setting that is on or off: its name and what it does, and the switch; clicking the name flips it too, as in system settings */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  children
}: {
  label: string
  description?: React.ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** anything said under the description, such as what turning it off means */
  children?: React.ReactNode
}) {
  const id = React.useId()
  const descriptionId = `${id}-description`
  return (
    <RowBetween>
      <div className="settings-row-text" style={{ opacity: disabled ? 'var(--opacity-disabled)' : undefined }}>
        <label htmlFor={id} className="text-item" style={{ display: 'block', cursor: disabled ? 'default' : 'pointer' }}>
          {label}
        </label>
        {description && <div id={descriptionId} className="text-sub">{description}</div>}
        {children}
      </div>
      <ToggleSwitch
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        describedBy={description ? descriptionId : undefined}
      />
    </RowBetween>
  )
}

export function Divider() {
  return (
    <div style={{
      height: '1px',
      background: 'var(--color-surface-offset)',
      margin: 'var(--space-4) 0'
    }} />
  )
}

export function RowBetween({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-4)'
    }}>
      {children}
    </div>
  )
}

/** settings still being read: rows of a name, its description and a switch, in the shape they'll have */
export function SettingsRowsSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <LoadingRegion label={label} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
            <Skeleton height="var(--space-3-5)" width={i % 2 ? '32%' : '40%'} />
            <Skeleton height="var(--space-2-5)" width={i % 2 ? '58%' : '66%'} />
          </div>
          <Skeleton width="var(--toggle-width)" height="var(--toggle-height)" borderRadius="var(--radius-full)" />
        </div>
      ))}
    </LoadingRegion>
  )
}

/** a whole card still being read, for sections that draw their own cards once loaded */
export function SettingsCardSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div style={{
      background: 'var(--color-surface-1)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-lg)'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-2)',
        borderTopLeftRadius: 'calc(var(--radius-lg) - 1px)',
        borderTopRightRadius: 'calc(var(--radius-lg) - 1px)'
      }}>
        <Skeleton width="var(--space-4)" height="var(--space-4)" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
          <Skeleton height="var(--space-3)" width="25%" />
          <Skeleton height="var(--space-2-5)" width="50%" />
        </div>
      </div>
      <div style={{ padding: 'var(--space-5)' }}>
        <SettingsRowsSkeleton label={label} rows={rows} />
      </div>
    </div>
  )
}
