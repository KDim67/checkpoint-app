import React from 'react'

/** passes FieldRow's id down so the label's htmlFor works without threading ids */
const FieldIdContext = React.createContext<string | undefined>(undefined)

/** not exported: components only, or hot reload breaks */
function useFieldId(explicitId?: string): string | undefined {
  const inherited = React.useContext(FieldIdContext)
  return explicitId ?? inherited
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
    <div style={{
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
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  // the label used to be unassociated; the id goes through context so the control can claim it
  const fieldId = React.useId()
  const hintId = `${fieldId}-hint`

  return (
    <div className="col-1-5">
      <label
        htmlFor={fieldId}
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--color-text-muted)',
          width: 'fit-content',
          cursor: 'pointer'
        }}
      >
        {label}
      </label>
      <FieldIdContext.Provider value={fieldId}>
        {children}
      </FieldIdContext.Provider>
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
  const fieldId = useFieldId(id)
  return (
    <input
      id={fieldId}
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
      className="border-offset focus-border-primary"
      style={{
        background: 'var(--color-surface-2)',
        color: 'var(--color-text-base)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-2) var(--space-3)',
        fontSize: 'var(--text-sm)',
        width: '100%',
        fontFamily: 'var(--font-sans)',
        transition: 'border-color 100ms ease'
        // no inline outline: none, it outranked the global :focus-visible ring
      }}
    />
  )
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** the switch has no text, screen readers need this */
  label?: string
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: '36px',
        height: '20px',
        borderRadius: '10px',
        background: checked ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        position: 'relative',
        transition: 'background 150ms ease',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1
      }}
    >
      <div style={{
        position: 'absolute',
        top: '3px',
        left: '3px',
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        background: checked ? 'var(--color-text-inverted)' : 'var(--color-text-faint)',
        // translateX is composited, animating left forces layout
        transform: checked ? 'translateX(16px)' : 'translateX(0)',
        transition: 'transform 150ms ease, background 150ms ease'
      }} />
    </button>
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
