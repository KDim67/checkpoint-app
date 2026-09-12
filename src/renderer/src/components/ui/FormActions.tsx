export default function FormActions({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
      <button
        type="button"
        onClick={onCancel}
        style={{
          background: 'transparent',
          border: '1px solid var(--color-surface-offset)',
          color: 'var(--color-text-base)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-4)',
          fontSize: 'var(--text-sm)',
          cursor: 'pointer'
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        Cancel
      </button>

      <button
        type="submit"
        style={{
          background: 'var(--color-secondary)',
          border: 'none',
          color: 'var(--color-text-inverted)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-4)',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-semibold)',
          cursor: 'pointer'
        }}
        onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
        onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
      >
        {submitLabel}
      </button>
    </div>
  )
}
