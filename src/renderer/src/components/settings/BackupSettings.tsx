import { useState, useEffect } from 'react'
import { useConfirm } from '../ui/ConfirmDialog'
import { FieldRow, ToggleSwitch, Divider, RowBetween } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { setBoolSetting, setNumberSetting, setStringSetting } from '../../lib/settings'
import * as backupApi from '../../data/backup'

// Database Backup Settings Section
export default function BackupSettings() {
  const confirm = useConfirm()
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(true)
  const [interval, setIntervalVal] = useState('daily')
  const [maxCount, setMaxCount] = useState(10)
  const [customPath, setCustomPath] = useState('')
  const [backups, setBackups] = useState<{
    filename: string
    timestamp: number
    size: number
    kind?: 'scheduled' | 'preRestore'
  }[]>([])

  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)


  const loadStatus = async () => {
    try {
      const status = await backupApi.getStatus()
      setEnabled(status.enabled)
      setIntervalVal(status.interval)
      setMaxCount(status.maxCount)
      setCustomPath(status.path)
      setBackups(status.backups)
    } catch (err) {
      console.error('Failed to load backup status:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const handleToggle = async (checked: boolean) => {
    try {
      setEnabled(checked)
      await setBoolSetting('feature_backup', checked)
      await backupApi.run('init')
      toast(checked ? 'Backup scheduler activated' : 'Backup scheduler deactivated')
      loadStatus()
    } catch (err) {
      console.error(err)
      toast('Failed to update backup settings')
    }
  }

  const handleIntervalChange = async (val: string) => {
    try {
      setIntervalVal(val)
      await setStringSetting('backup_interval', val)
      await backupApi.run('init')
      toast(`Backup schedule set to: ${val}`)
      loadStatus()
    } catch (err) {
      console.error(err)
    }
  }

  const handleMaxCountChange = async (val: number) => {
    const cleanVal = Math.max(1, Math.min(100, val))
    try {
      setMaxCount(cleanVal)
      await setNumberSetting('backup_max_count', cleanVal)
      await backupApi.run('init')
      loadStatus()
    } catch (err) {
      console.error(err)
    }
  }

  const handlePathBlur = async () => {
    try {
      await setStringSetting('backup_path', customPath.trim())
      await backupApi.run('init')
      toast('Backup destination path updated')
      loadStatus()
    } catch (err) {
      console.error(err)
    }
  }

  const handleBackupNow = async () => {
    if (running) return
    setRunning(true)
    try {
      await backupApi.run('backup')
      toast('Backup created successfully!')
      loadStatus()
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      toast(`Backup failed: ${msg}`)
    } finally {
      setRunning(false)
    }
  }

  const handleDelete = async (filename: string) => {
    try {
      await backupApi.run('delete', filename)
      toast('Backup archive deleted')
      loadStatus()
    } catch (err) {
      console.error(err)
      toast('Failed to delete backup archive')
    }
  }

  const handleRestore = async (filename: string) => {
    const ok = await confirm({
      title: 'Confirm Database Restore',
      message: `Are you sure you want to restore ${filename}?`,
      warning: 'This will overwrite your current active database. To prevent data loss, a safety backup of your current database is created first.',
      confirmText: 'Yes, Restore Database',
      isDestructive: true
    })
    if (!ok) return

    setRestoring(filename)
    toast('Restoring database, please wait...')
    try {
      await backupApi.run('restore', filename)
      toast('Database restored successfully! App state reloaded.')
      loadStatus()
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      toast(`Restore failed: ${msg}`)
    } finally {
      setRestoring(null)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    const mb = kb / 1024
    return `${mb.toFixed(1)} MB`
  }

  if (loading) return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>Loading backup vault…</div>

  return (
    <div className="col-xl">
      <RowBetween>
        <div>
          <div className="text-item">
            Automated Backups
          </div>
          <div className="text-sub">
            Periodically saves transactionally consistent snapshots of your active database.
          </div>
        </div>
        <ToggleSwitch checked={enabled} onChange={handleToggle} label="Automated Backups" />
      </RowBetween>

      {enabled && (
        <>
          <Divider />

          {/* Backup Path */}
          <FieldRow label="Backup Directory Path">
            <input
              value={customPath}
              onChange={e => setCustomPath(e.target.value)}
              onBlur={handlePathBlur}
              placeholder="Default: <App Data>/backups"
              style={{
                width: '100%',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--text-sm)',
                outline: 'none'
              }}
            />
          </FieldRow>

          {/* Interval */}
          <FieldRow label="Backup Interval">
            <select
              value={interval}
              onChange={e => handleIntervalChange(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="daily">Daily Check</option>
              <option value="weekly">Weekly Check</option>
              <option value="launch-exit">On Launch and Exit</option>
            </select>
          </FieldRow>

          {/* Max kept backups */}
          <FieldRow label="Rolling Retention Limit">
            <div className="row">
              <input
                type="number"
                min={1}
                max={100}
                value={maxCount}
                onChange={e => handleMaxCountChange(parseInt(e.target.value) || 10)}
                style={{
                  width: '80px',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  outline: 'none',
                  textAlign: 'center'
                }}
              />
              <span className="text-hint-faint">
                Maximum number of rolling backup files kept before pruning.
              </span>
            </div>
          </FieldRow>

          <Divider />

          {/* Trigger & List */}
          <div className="row-between">
            <div className="text-item-strong">
              Backup Archives
            </div>
            <button
              onClick={handleBackupNow}
              disabled={running}
              style={{
                background: 'var(--color-secondary)',
                border: 'none',
                color: 'var(--color-text-inverted)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-1.5) var(--space-4)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-bold)',
                cursor: running ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1.5)',
                transition: 'filter var(--duration-fast)'
              }}
              onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.1)')}
              onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
            >
              {running ? 'Creating Backup...' : 'Backup Database Now'}
            </button>
          </div>

          {backups.length === 0 ? (
            <div style={{ padding: 'var(--space-6) 0', textAlign: 'center', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
              No database backups created yet. Click the button above to generate your first snapshot.
            </div>
          ) : (
            <div
              style={{
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                background: 'var(--color-surface-1)'
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>Archive File</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>Date Created</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right' }}>Compressed Size</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center', width: '150px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map(b => (
                    <tr key={b.filename} style={{ borderBottom: '1px solid var(--color-surface-offset)', color: 'var(--color-text-base)' }}>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                        {b.filename}
                        {b.kind === 'preRestore' && (
                          <span
                            title="Taken automatically just before a restore, so the restore can be undone."
                            style={{
                              marginLeft: 'var(--space-2)',
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-full, 999px)',
                              background: 'var(--color-surface-2)',
                              color: 'var(--color-text-muted)',
                              fontFamily: 'var(--font-sans)',
                              fontSize: '9px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            before a restore
                          </span>
                        )}
                      </td>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', color: 'var(--color-text-muted)' }}>
                        {new Date(b.timestamp).toLocaleString()}
                      </td>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {formatSize(b.size)}
                      </td>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleRestore(b.filename)}
                          disabled={restoring !== null}
                          style={{
                            background: 'var(--color-primary-muted)',
                            border: '1px solid var(--color-primary)',
                            color: 'var(--color-text-base)',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            cursor: restoring !== null ? 'default' : 'pointer',
                            fontSize: '10px'
                          }}
                        >
                          {restoring === b.filename ? 'Restoring...' : 'Restore'}
                        </button>
                        <button
                          onClick={() => handleDelete(b.filename)}
                          disabled={restoring !== null}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--color-surface-offset)',
                            color: 'var(--color-error)',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            cursor: restoring !== null ? 'default' : 'pointer',
                            fontSize: '10px'
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

    </div>
  )
}
