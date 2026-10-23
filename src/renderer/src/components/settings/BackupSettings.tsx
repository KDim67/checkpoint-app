import { useState, useEffect, useCallback } from 'react'
import { Archive, Clock, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useConfirm } from '../ui/ConfirmDialog'
import SettingsSection, { FieldRow, ToggleRow, Divider, SettingsInput, SettingsSelect, SettingsCardSkeleton } from './SettingsSection'
import { useToast, useFailureReport } from '../ui/Toast'
import { setBoolSetting, setNumberSetting, setStringSetting } from '../../lib/settings'
import * as backupApi from '../../data/backup'

interface Backup {
  filename: string
  timestamp: number
  size: number
  kind?: 'scheduled' | 'preRestore' | 'preUpdate'
  /** the version a copy before an update was made for */
  version?: string
}

/** the day and time, the year only when it isn't this one */
function whenOf(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** only the copies the app made on its own get a label; every other one is a plain backup */
function madeFor(backup: Backup): { label: string; why: string } | null {
  if (backup.kind === 'preRestore') {
    return { label: 'Before a restore', why: 'Taken automatically just before a restore, so the restore can be undone.' }
  }
  if (backup.kind === 'preUpdate') {
    return {
      label: backup.version ? `Before updating to ${backup.version}` : 'Before an update',
      why: 'Taken automatically just before a new version of Checkpoint changed your data, so the update can be undone.'
    }
  }
  return null
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export default function BackupSettings() {
  const confirm = useConfirm()
  const { toast } = useToast()
  const report = useFailureReport()
  const [enabled, setEnabled] = useState(true)
  const [interval, setIntervalVal] = useState('daily')
  const [maxCount, setMaxCount] = useState(10)
  const [customPath, setCustomPath] = useState('')
  const [backups, setBackups] = useState<Backup[]>([])

  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)


  // stable, so the effect below can list it without running again
  const loadStatus = useCallback(async () => {
    try {
      const status = await backupApi.getStatus()
      setEnabled(status.enabled)
      setIntervalVal(status.interval)
      setMaxCount(status.maxCount)
      setCustomPath(status.path)
      setBackups(status.backups)
    } catch (err) {
      report('read the backup status', err)
    } finally {
      setLoading(false)
    }
  }, [report])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handleToggle = async (checked: boolean) => {
    try {
      setEnabled(checked)
      await setBoolSetting('feature_backup', checked)
      await backupApi.run('init')
      toast(checked ? 'Automatic backups on' : 'Automatic backups off')
      loadStatus()
    } catch (err) {
      setEnabled(!checked)
      report(checked ? 'turn automatic backups on' : 'turn automatic backups off', err)
    }
  }

  const handleIntervalChange = async (val: string) => {
    try {
      setIntervalVal(val)
      await setStringSetting('backup_interval', val)
      await backupApi.run('init')
      loadStatus()
    } catch (err) {
      report('change the backup schedule', err)
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
      report('change how many backups are kept', err)
    }
  }

  const handlePathBlur = async () => {
    try {
      await setStringSetting('backup_path', customPath.trim())
      await backupApi.run('init')
      toast('Backups now go to the new folder')
      loadStatus()
    } catch (err) {
      report('change the backup folder', err)
    }
  }

  const handleBackupNow = async () => {
    if (running) return
    setRunning(true)
    try {
      await backupApi.run('backup')
      toast('Backed up')
      loadStatus()
    } catch (err) {
      report('back up', err)
    } finally {
      setRunning(false)
    }
  }

  // a backup is the way back from a mistake, so losing one is asked about first
  const handleDelete = async (backup: Backup) => {
    const ok = await confirm({
      title: 'Delete this backup?',
      message: `The backup from ${whenOf(backup.timestamp)} is deleted from the backups folder and can't be brought back.`,
      confirmText: 'Delete',
      isDestructive: true
    })
    if (!ok) return
    try {
      await backupApi.run('delete', backup.filename)
      toast('Backup deleted')
      loadStatus()
    } catch (err) {
      report('delete the backup', err)
    }
  }

  const handleRestore = async (backup: Backup) => {
    const ok = await confirm({
      title: 'Restore this backup?',
      message: `Everything goes back to how it was on ${whenOf(backup.timestamp)}.`,
      warning: 'A copy of how things are now is saved first, so you can undo this from the list below.',
      confirmText: 'Restore',
      isDestructive: true
    })
    if (!ok) return

    setRestoring(backup.filename)
    try {
      await backupApi.run('restore', backup.filename)
      toast('Backup restored')
      loadStatus()
    } catch (err) {
      report('restore the backup', err)
    } finally {
      setRestoring(null)
    }
  }

  if (loading) return <SettingsCardSkeleton label="Loading the backups" rows={3} />

  return (
    <>
      <SettingsSection icon={<Clock size={14} />} title="Automatic Backups" description="When copies are made, where they go and how many are kept.">
        <div className="col-xl">
          <ToggleRow
            label="Automatic backups"
            description="A complete copy of your data, made safely even while Checkpoint is busy."
            checked={enabled}
            onChange={handleToggle}
          />

          {enabled && (
            <>
              <Divider />

              <FieldRow label="Backup folder" hint="Leave it empty to keep them in Checkpoint's own data folder.">
                <SettingsInput
                  value={customPath}
                  onChange={setCustomPath}
                  onBlur={handlePathBlur}
                  placeholder="Checkpoint's data folder"
                />
              </FieldRow>

              <FieldRow label="How often">
                <SettingsSelect
                  value={interval}
                  onChange={e => handleIntervalChange(e.target.value)}
                >
                  <option value="daily">Once a day</option>
                  <option value="weekly">Once a week</option>
                  <option value="launch-exit">Each time Checkpoint opens and closes</option>
                </SettingsSelect>
              </FieldRow>

              <FieldRow label="Backups to keep" hint="The oldest is deleted once there are more. Between 1 and 100.">
                <SettingsInput
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={maxCount || ''}
                  // kept on blur; saving each keystroke clamped 25 to 2 on the way
                  onChange={v => setMaxCount(parseInt(v, 10) || 0)}
                  onBlur={() => handleMaxCountChange(maxCount || 10)}
                />
              </FieldRow>
            </>
          )}
        </div>
      </SettingsSection>

      {/* here whatever the schedule, so switching it off never hides the copies already made */}
      <SettingsSection icon={<Archive size={14} />} title="Backups" description="Newest first. Restoring one saves a copy of how things are now before it.">
      <div className="col-lg">
        <div className="row-between">
          <div className="text-sub">
            {backups.length === 0 ? '' : backups.length === 1 ? 'One backup' : `${backups.length} backups`}
          </div>
          <button type="button" className="btn-primary backup-now" onClick={handleBackupNow} disabled={running}>
            {running ? 'Backing up…' : 'Back up now'}
          </button>
        </div>

        {backups.length === 0 ? (
          <p className="backup-empty">No backups yet. Back up now to make the first one.</p>
        ) : (
          <ul className="backup-list" aria-label="Backups">
            {backups.map(backup => {
              const when = whenOf(backup.timestamp)
              const made = madeFor(backup)
              return (
                <li key={backup.filename} className="backup-row">
                  <Archive size={16} className="backup-row-icon" aria-hidden="true" />
                  <div className="backup-row-text">
                    <div className="backup-row-when">
                      <time dateTime={new Date(backup.timestamp).toISOString()}>{when}</time>
                      <span className="backup-row-ago">{formatDistanceToNow(backup.timestamp, { addSuffix: true })}</span>
                    </div>
                    <div className="backup-row-detail">
                      {made && <span className="backup-badge" title={made.why}>{made.label}</span>}
                      {/* the name to look for in the backups folder, cut short with the whole of it on hover */}
                      <span className="backup-row-file" title={backup.filename}>{backup.filename}</span>
                    </div>
                  </div>
                  <span className="backup-row-size">{formatSize(backup.size)}</span>
                  <div className="backup-row-actions">
                    <button
                      type="button"
                      className="btn-secondary backup-action"
                      onClick={() => handleRestore(backup)}
                      disabled={restoring !== null}
                    >
                      {restoring === backup.filename ? 'Restoring…' : 'Restore'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost backup-delete"
                      onClick={() => handleDelete(backup)}
                      disabled={restoring !== null}
                      aria-label={`Delete the backup from ${when}`}
                      title="Delete"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      </SettingsSection>
    </>
  )
}
