import React, { useState } from 'react'
import { Download } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { workspaceName } from '../../lib/createWorkspace'
import { FieldRow } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { EXPORT_FORMATS, type ExportFormat } from '../../../../shared/exportFormats'
import * as exporterApi from '../../data/exporter'

export default function ExportPanel(): React.JSX.Element {
  const { toast } = useToast()
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const workspaceList = useAppStore(s => s.workspaceList)
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [scope, setScope] = useState<'current' | 'all'>('current')
  const [busy, setBusy] = useState(false)

  const handleExport = async () => {
    setBusy(true)
    try {
      const result = await exporterApi.items({
        context: scope === 'all' ? null : activeWorkspace,
        format
      })
      // a cancelled dialog isn't a failure
      if (result.ok) toast(`Exported ${result.count} item${result.count === 1 ? '' : 's'}`)
      else if (result.reason !== 'cancelled') toast(result.reason ?? 'Could not export. Try again.')
    } catch (err) {
      console.error(err)
      toast('Could not export. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col-lg">
      <p className="text-sub" style={{ margin: 0 }}>
        Tags come along. Notes aren't included, since they are already Markdown files in their folder.
      </p>

      <FieldRow label="What to export" group>
        <div className="settings-choices" data-fit="">
          <button type="button" className="settings-choice" aria-pressed={scope === 'current'} onClick={() => setScope('current')}>
            {workspaceName(activeWorkspace, workspaceList)}
          </button>
          <button type="button" className="settings-choice" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            All workspaces
          </button>
        </div>
      </FieldRow>

      <FieldRow label="As" group>
        <div className="settings-choices" data-fit="">
          {EXPORT_FORMATS.map(f => (
            <button key={f.id} type="button" className="settings-choice" aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </FieldRow>

      <div>
        <button
          type="button"
          className="btn-primary btn-with-icon"
          onClick={handleExport}
          disabled={busy}
        >
          <Download size={14} aria-hidden="true" />
          {busy ? 'Exporting…' : 'Export…'}
        </button>
      </div>
    </div>
  )
}
