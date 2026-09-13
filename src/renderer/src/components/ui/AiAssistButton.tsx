import { Sparkles } from 'lucide-react'

export default function AiAssistButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="hover-lift ai-assist-button"
      style={{
        background: 'var(--color-secondary-muted)',
        border: '1.5px solid var(--color-secondary)',
        color: 'var(--color-secondary)',
        borderRadius: 'var(--radius-md)',
        padding: '6px 14px',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-bold)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
      }}
    >
      <Sparkles size={16} fill="currentColor" />
      <span>AI Assist</span>
    </button>
  )
}
