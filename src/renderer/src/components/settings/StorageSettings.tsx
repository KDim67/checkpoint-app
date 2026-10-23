import { useState, useEffect } from 'react'
import { Download, Paperclip } from 'lucide-react'
import ExportPanel from './ExportPanel'
import SettingsSection, { Divider, SettingsRowsSkeleton } from './SettingsSection'
import PathRow from './PathRow'
import { useToast, useFailureReport } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import * as mediaApi from '../../data/media'
import * as appApi from '../../data/app'

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

export default function StorageSettings() {
  const { toast } = useToast()
  const report = useFailureReport()
  const confirm = useConfirm()
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

  // files go for good, so it's asked about first
  const handlePrune = async () => {
    const ok = await confirm({
      title: 'Delete unused attachments?',
      message: 'Checkpoint looks through every log entry, task and note, and deletes the attached files none of them use any more.',
      warning: "They can't be brought back, and backups don't hold attachments.",
      confirmText: 'Delete unused',
      isDestructive: true
    })
    if (!ok) return
    setPruning(true)
    try {
      const res = await mediaApi.scanAndPrune()
      setPrunedResult({
        prunedCount: res.prunedCount,
        spaceSavedBytes: res.spaceSavedBytes,
        prunedFiles: res.prunedFiles
      })
      toast(res.prunedCount === 0
        ? 'Every attachment is in use, so nothing was deleted'
        : `Deleted ${res.prunedCount === 1 ? 'one unused attachment' : `${res.prunedCount} unused attachments`}`)
      loadStorageInfo()
    } catch (err) {
      report('clean up the attachments', err)
    } finally {
      setPruning(false)
    }
  }

  const fileCount = storageInfo?.fileCount ?? 0

  return (
    <>
      <SettingsSection icon={<Download size={14} />} title="Export" description="Your cards, tasks and log entries as files you can open anywhere.">
        <ExportPanel />
      </SettingsSection>

      <SettingsSection icon={<Paperclip size={14} />} title="Attachments" description="Images and files added to log entries, tasks and notes.">
        {loading && !storageInfo ? (
          <SettingsRowsSkeleton label="Loading the attachments" rows={2} />
        ) : (
          <div className="col-lg">
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-4)', margin: 0 }}>
              <div className="col-4px">
                <dt className="text-hint">Files</dt>
                <dd style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)', fontVariantNumeric: 'tabular-nums' }}>
                  {fileCount}
                </dd>
              </div>
              <div className="col-4px">
                <dt className="text-hint">Space used</dt>
                <dd style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatSize(storageInfo?.totalSize ?? 0)}
                </dd>
              </div>
            </dl>

            <div className="col-1-5">
              <span className="text-hint">Folder</span>
              <PathRow openTitle="Open the attachments folder" onOpen={() => storageInfo && appApi.openExternal(`file://${storageInfo.path}`)}>
                {storageInfo?.path ?? ''}
              </PathRow>
            </div>

            <Divider />

            <div className="row-between" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
              <div className="settings-row-text">
                <div className="text-item">
                  Clean up unused attachments
                </div>
                <div className="text-sub" style={{ lineHeight: 'var(--leading-normal)' }}>
                  Deletes files that no log entry, task or note uses any more, such as an image whose entry you deleted.
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary hover-text-error"
                onClick={handlePrune}
                disabled={pruning || fileCount === 0}
              >
                {pruning ? 'Cleaning up…' : 'Clean up…'}
              </button>
            </div>

            {prunedResult && prunedResult.prunedCount > 0 && (
              <div className="settings-callout" role="status" style={{ flexDirection: 'column' }}>
                <div className="row-between" style={{ width: '100%' }}>
                  <span className="text-label-xs-semibold">
                    Deleted {prunedResult.prunedCount === 1 ? 'one file' : `${prunedResult.prunedCount} files`}
                  </span>
                  <span className="text-hint">{formatSize(prunedResult.spaceSavedBytes)} freed</span>
                </div>
                <ul className="custom-scrollbar" style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)', maxHeight: '6.5rem', overflowY: 'auto', width: '100%' }}>
                  {prunedResult.prunedFiles.map(file => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </SettingsSection>
    </>
  )
}
