// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'
import { ConfirmProvider } from '../src/renderer/src/components/ui/ConfirmDialog'

const vault = vi.hoisted(() => ({
  enabled: true,
  run: vi.fn(async (..._args: unknown[]) => {})
}))

vi.mock('../src/renderer/src/data/backup', () => ({
  getStatus: async () => ({
    enabled: vault.enabled,
    interval: 'daily',
    maxCount: 10,
    path: '',
    backups: [
      { filename: 'pre_update_1700000000000_1.2.0.db.gz', timestamp: 1700000000000, size: 2048, kind: 'preUpdate', version: '1.2.0' },
      { filename: 'pre_restore_1690000000000.db.gz', timestamp: 1690000000000, size: 2048, kind: 'preRestore' },
      { filename: 'backup_1680000000000.db.gz', timestamp: 1680000000000, size: 2048, kind: 'scheduled' }
    ]
  }),
  run: vault.run
}))

vi.mock('../src/renderer/src/lib/settings', () => ({
  setBoolSetting: vi.fn(async () => {}),
  setNumberSetting: vi.fn(async () => {}),
  setStringSetting: vi.fn(async () => {})
}))

beforeEach(() => {
  vault.enabled = true
  vault.run.mockClear()
})

afterEach(cleanup)

async function open(): Promise<void> {
  const { default: BackupSettings } = await import('../src/renderer/src/components/settings/BackupSettings')
  await act(async () => { render(<ToastProvider><ConfirmProvider><BackupSettings /></ConfirmProvider></ToastProvider>) })
}

const rows = (): HTMLElement[] => within(screen.getByRole('list', { name: 'Backups' })).getAllByRole('listitem')

describe('the backups list in Settings', () => {
  it('marks the copy made before an update with the version it was made for, beside the one before a restore', async () => {
    await open()
    expect(screen.getByText('Before updating to 1.2.0')).not.toBeNull()
    expect(screen.getByText('Before a restore')).not.toBeNull()
  })

  it('leads each backup with when it was made, keeping the file name for finding it in the folder', async () => {
    await open()
    const time = rows()[2].querySelector('time')
    expect(time?.getAttribute('dateTime')).toBe(new Date(1680000000000).toISOString())
    expect(within(rows()[2]).getByText('backup_1680000000000.db.gz').getAttribute('title')).toBe('backup_1680000000000.db.gz')
    expect(within(rows()[2]).getByText('2.0 KB')).not.toBeNull()
  })

  it('stays in reach with the schedule switched off, so the backups already made can still be restored', async () => {
    vault.enabled = false
    await open()
    expect(rows()).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Back up now' })).not.toBeNull()
  })

  it('asks before deleting a backup, and keeps it when you say no', async () => {
    await open()
    const remove = within(rows()[2]).getByRole('button', { name: /^Delete the backup from / })

    fireEvent.click(remove)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(vault.run).not.toHaveBeenCalledWith('delete', expect.anything())

    fireEvent.click(remove)
    expect(await screen.findByText('Delete this backup?')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(vault.run).toHaveBeenCalledWith('delete', 'backup_1680000000000.db.gz'))
  })

  it('asks before a restore, naming when the backup was made', async () => {
    await open()
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Restore' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Everything goes back to how it was on /)).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(vault.run).toHaveBeenCalledWith('restore', 'pre_update_1700000000000_1.2.0.db.gz'))
  })
})
