import type { ReactNode } from 'react'
import { Settings } from 'lucide-react'

export default function SettingsColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{
      background: 'var(--color-surface-1)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
      overflowY: 'auto'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
        <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
        <span className="label-caps">
          {title}
        </span>
      </div>
      {children}
    </div>
  )
}
