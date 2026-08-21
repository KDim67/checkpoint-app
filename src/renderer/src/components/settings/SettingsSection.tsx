import React from 'react'

interface SettingsSectionProps {
  icon: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
}

/**
 * Reusable section wrapper for the Settings view.
 * Renders a titled card with a divider and slotted content.
 */
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
      {/* Section header */}
      <div style={{
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--color-surface-offset)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        background: 'var(--color-surface-2)'
      }}>
        <span style={{ color: 'var(--color-secondary)', display: 'flex', flexShrink: 0 }}>
          {icon}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-bold)',
            color: 'var(--color-text-base)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)'
          }}>
            {title}
          </div>
          {description && (
            <div style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-faint)',
              marginTop: '2px'
            }}>
              {description}
            </div>
          )}
        </div>
      </div>

      {/* Section body */}
      <div style={{ padding: 'var(--space-5)' }}>
        {children}
      </div>
    </div>
  )
}

// Shared utility styles

export function FieldRow({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-1-5)'
    }}>
      <label style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)',
        color: 'var(--color-text-muted)'
      }}>
        {label}
      </label>
      {children}
      {hint && (
        <span style={{
          fontSize: '11px',
          color: 'var(--color-text-faint)'
        }}>
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
  type = 'text'
}: {
  value: string | number
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        color: 'var(--color-text-base)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-2) var(--space-3)',
        fontSize: 'var(--text-sm)',
        outline: 'none',
        width: '100%',
        fontFamily: 'var(--font-sans)',
        transition: 'border-color 100ms ease'
      }}
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
      onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
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
  /** Accessible name. The switch renders no text, so without it screen readers announce nothing. */
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
        left: checked ? '19px' : '3px',
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        background: checked ? 'var(--color-text-inverted)' : 'var(--color-text-faint)',
        transition: 'left 150ms ease, background 150ms ease'
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
