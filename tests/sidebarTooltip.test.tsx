// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../src/renderer/src/lib/settings', () => ({
  getBoolSetting: vi.fn(async (_key: string, fallback: boolean) => fallback),
  getStringSetting: vi.fn(async (_key: string, fallback: string) => fallback),
  setStringSetting: vi.fn(async () => {})
}))
vi.mock('../src/renderer/src/data/sync', () => ({
  onSyncProgress: () => () => {}, getStatus: vi.fn(async () => ({ syncing: false })), triggerSync: vi.fn(async () => {})
}))
const renewals = vi.hoisted(() => ({ list: vi.fn(async () => ({ ok: true, value: [] as unknown[] })) }))
vi.mock('../src/renderer/src/data/renewals', () => renewals)
vi.mock('../src/renderer/src/data/mcp', () => ({ onDataChanged: () => () => {} }))

import { Sidebar } from '../src/renderer/src/components/Sidebar'
import { normalizeRenewal } from '../src/shared/renewal'
import { allDay, localDayOf } from '../src/shared/dueDate'

afterEach(cleanup)

describe('the sidebar labels', () => {
  it('name the view and the key that goes there, on hover and on keyboard focus', async () => {
    await act(async () => { render(<Sidebar />) })
    const wall = screen.getByLabelText('Wall')

    fireEvent.mouseEnter(wall)
    expect(screen.getByText('Ctrl+6')).toBeTruthy()
    fireEvent.mouseLeave(wall)
    expect(screen.queryByText('Ctrl+6')).toBeNull()

    fireEvent.focus(wall)
    expect(screen.getByText('Ctrl+6')).toBeTruthy()
  })

  it('counts the renewals that need a look on their tab', async () => {
    const today = localDayOf(Date.now())
    const soon = normalizeRenewal({ expiresAt: allDay({ ...today, day: today.day + 3 }) }).meta
    const later = normalizeRenewal({ expiresAt: allDay({ ...today, day: today.day + 90 }) }).meta
    renewals.list.mockResolvedValueOnce({ ok: true, value: [{ status: 'active', meta: soon }, { status: 'active', meta: later }] })
    await act(async () => { render(<Sidebar />) })
    expect(screen.getByLabelText('Renewals, 1 need a look')).toBeTruthy()
  })
})
