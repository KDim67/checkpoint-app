import { useState, useEffect } from 'react'
import ExportPanel from './ExportPanel'
import { useToast } from '../ui/Toast'
import * as mediaApi from '../../data/media'

export default function StorageSettings() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [pruning, setPruning] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{ fileCount: number; totalSize: number; path: string } | null>(null)
  const [prunedResult, setPrunedResult] = useState<{
    prunedCount: number
    spaceSavedBytes: number
    prunedFiles: string[]
  } | null>(null)

  const loadStorageInfo = async () => {
    setLoading(true)
    try {
      const info = await mediaApi.getStorageInfo()
      setStorageInfo(info)
    } catch (err) {
      console.error('Failed to load storage info:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStorageInfo()
  }, [])

  const handlePrune = async () => {
    setPruning(true)
    try {
      const res = await mediaApi.scanAndPrune()
      setPrunedResult({
        prunedCount: res.prunedCount,
        spaceSavedBytes: res.spaceSavedBytes,
        prunedFiles: res.prunedFiles
      })
      toast(`Successfully pruned ${res.prunedCount} orphaned files!`)
      loadStorageInfo()
    } catch (err) {
      console.error('Failed to prune media:', err)
      toast('Failed to prune media vault')
    } finally {
      setPruning(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    const mb = kb / 1024
    return `${mb.toFixed(1)} MB`
  }

  if (loading && !storageInfo) {
    return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)', padding: 'var(--space-4) 0' }}>Loading storage statistics…</div>
  }

  return (
    <div className="col-xl">
      <div style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
        <ExportPanel />
      </div>

      <div style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-faint)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-3)' }}>
          Media Vault Statistics
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="col-4px">
            <span className="text-micro">Files count</span>
            <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-secondary)' }}>
              {storageInfo?.fileCount ?? 0}
            </span>
          </div>
          <div className="col-4px">
            <span className="text-micro">Active disk size</span>
            <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-secondary)' }}>
              {formatSize(storageInfo?.totalSize ?? 0)}
            </span>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--color-surface-offset)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span className="text-micro">Vault Directory Path</span>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-base)', wordBreak: 'break-all' }}>
            {storageInfo?.path ?? ''}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
        <div style={{ flex: 1, paddingRight: 'var(--space-4)' }}>
          <div className="text-item">
            Prune Orphaned Media
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px', maxWidth: '380px', lineHeight: 1.4 }}>
            Scans all logs, backlog tasks, and markdown notes for media references. Files in the media vault that are no longer linked are permanently deleted.
          </div>
        </div>
        <button
          onClick={handlePrune}
          disabled={pruning || storageInfo?.fileCount === 0}
          className="storage-settings-prune"
          style={{
            background: storageInfo?.fileCount === 0 ? 'var(--color-surface-offset)' : 'var(--color-secondary)',
            border: 'none',
            color: storageInfo?.fileCount === 0 ? 'var(--color-text-muted)' : 'var(--color-text-inverted)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-bold)',
            cursor: pruning || storageInfo?.fileCount === 0 ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1.5)',
            transition: 'filter var(--duration-fast)',
            flexShrink: 0
          }}
        >
          {pruning ? 'Cleaning up...' : 'Scan & Prune Vault'}
        </button>
      </div>

      {prunedResult && prunedResult.prunedCount > 0 && (
        <div style={{
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface-2)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)'
        }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Cleanup Report</span>
            <span className="text-accent">Saved {formatSize(prunedResult.spaceSavedBytes)}</span>
          </div>
          <div className="text-caption">
            Successfully deleted {prunedResult.prunedCount} orphaned image files:
          </div>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-faint)', maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }} className="custom-scrollbar">
            {prunedResult.prunedFiles.map(file => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
