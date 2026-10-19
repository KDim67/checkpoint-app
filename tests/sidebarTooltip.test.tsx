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
import { useAppStore } from '../src/renderer/src/store/appStore'
import { setStringSetting } from '../src/renderer/src/lib/settings'

afterEach(cleanup)

describe('the logo', () => {
  it('opens the Workspaces page, and a second click goes back to the view it came from', async () => {
    useAppStore.setState({ activeView: 'calendar', returnView: 'kanban', activeWorkspace: 'work', workspaceList: [{ slug: 'work', name: 'Work', color: '#10b981' }] })
    await act(async () => { render(<Sidebar />) })
    const logo = screen.getByRole('button', { name: 'Workspaces, current workspace Work' })
    fireEvent.click(logo)
    expect(useAppStore.getState()).toMatchObject({ activeView: 'workspaces', returnView: 'calendar' })
    expect(logo.getAttribute('aria-current')).toBe('page')
    fireEvent.click(logo)
    expect(useAppStore.getState().activeView).toBe('calendar')
  })

  it('never remembers the Workspaces page as the view to start on', () => {
    const settings = vi.mocked(setStringSetting)
    settings.mockClear()
    useAppStore.getState().setView('workspaces')
    useAppStore.getState().setView('log')
    expect(settings.mock.calls.map(call => call[1])).toEqual(['log'])
  })
})

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
