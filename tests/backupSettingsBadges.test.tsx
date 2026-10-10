// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'
import { ConfirmProvider } from '../src/renderer/src/components/ui/ConfirmDialog'

vi.mock('../src/renderer/src/data/backup', () => ({
  getStatus: async () => ({
    enabled: true,
    interval: 'daily',
    maxCount: 10,
    path: '',
    backups: [
      { filename: 'pre_update_1700000000000_1.2.0.db.gz', timestamp: 1700000000000, size: 2048, kind: 'preUpdate', version: '1.2.0' },
      { filename: 'pre_restore_1690000000000.db.gz', timestamp: 1690000000000, size: 2048, kind: 'preRestore' },
      { filename: 'backup_1680000000000.db.gz', timestamp: 1680000000000, size: 2048, kind: 'scheduled' }
    ]
  }),
  run: async () => {}
}))

afterEach(cleanup)

describe('the backups list in Settings', () => {
  it('marks the copy made before an update with the version it was made for, beside the one before a restore', async () => {
    const { default: BackupSettings } = await import('../src/renderer/src/components/settings/BackupSettings')
    await act(async () => { render(<ToastProvider><ConfirmProvider><BackupSettings /></ConfirmProvider></ToastProvider>) })
    expect(screen.getByText('before updating to 1.2.0')).not.toBeNull()
    expect(screen.getByText('before a restore')).not.toBeNull()
  })
})
