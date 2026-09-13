export default function FormActions({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
      <button
        type="button"
        onClick={onCancel}
        className="bg-clear hover-bg-offset"
        style={{
          border: '1px solid var(--color-surface-offset)',
          color: 'var(--color-text-base)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-4)',
          fontSize: 'var(--text-sm)',
          cursor: 'pointer'
        }}
      >
        Cancel
      </button>

      <button
        type="submit"
        className="hover-brighten"
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
      >
        {submitLabel}
      </button>
    </div>
  )
}
