import React, { useState } from 'react'
import { Download } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import { EXPORT_FORMATS, type ExportFormat } from '../../../../shared/exportFormats'

export default function ExportPanel(): React.JSX.Element {
  const { toast } = useToast()
  const activeContext = useAppStore(s => s.activeContext)
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [scope, setScope] = useState<'current' | 'all'>('current')
  const [busy, setBusy] = useState(false)

  const handleExport = async () => {
    setBusy(true)
    try {
      const result = await window.electronAPI.exporter.items({
        context: scope === 'all' ? null : activeContext,
        format
      })
      // A cancelled save dialog is not a failure and should not read like one.
      if (result.ok) toast(`Exported ${result.count} item${result.count === 1 ? '' : 's'}`)
      else if (result.reason !== 'cancelled') toast(result.reason ?? 'Export failed')
    } catch (err) {
      console.error(err)
      toast('Export failed')
    } finally {
      setBusy(false)
    }
  }

  const choice = (active: boolean): React.CSSProperties => ({
    padding: 'var(--space-2) var(--space-3)',
    background: active ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
    border: `1px solid ${active ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
    color: active ? 'var(--color-secondary)' : 'var(--color-text-muted)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-xs)',
    cursor: 'pointer'
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
          Export your data
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px' }}>
          Cards, tasks and log entries with their tags. Notes are already plain
          markdown files on disk.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button onClick={() => setScope('current')} style={choice(scope === 'current')}>
          {activeContext}
        </button>
        <button onClick={() => setScope('all')} style={choice(scope === 'all')}>
          All workspaces
        </button>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {EXPORT_FORMATS.map(f => (
          <button key={f.id} onClick={() => setFormat(f.id)} style={choice(format === f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div>
        <button
          className="btn-primary"
          onClick={handleExport}
          disabled={busy}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <Download size={13} />
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </div>
  )
}
