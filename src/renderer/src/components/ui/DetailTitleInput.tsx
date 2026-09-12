import type { FocusEventHandler, Ref } from 'react'

interface DetailTitleInputProps {
  inputRef: Ref<HTMLInputElement>
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: FocusEventHandler<HTMLInputElement>
  placeholder: string
}

export default function DetailTitleInput({ inputRef, id, value, onChange, onBlur, placeholder }: DetailTitleInputProps) {
  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      style={{
        width: '100%',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid transparent',
        fontSize: 'var(--text-xl)',
        fontWeight: 'var(--weight-bold)',
        color: 'var(--color-text-base)',
        outline: 'none',
        padding: '4px 0',
        transition: 'border-color var(--duration-fast)'
      }}
      onFocus={e => (e.target.style.borderBottomColor = 'var(--color-surface-offset)')}
      onBlurCapture={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
    />
  )
}
