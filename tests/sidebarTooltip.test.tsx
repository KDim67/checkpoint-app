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
    useAppStore.setState({ activeView: 'calendar', backTrail: [], activeWorkspace: 'work', workspaceList: [{ slug: 'work', name: 'Work', color: '#10b981' }] })
    await act(async () => { render(<Sidebar />) })
    const logo = screen.getByRole('button', { name: 'Workspaces, current workspace Work' })
    fireEvent.click(logo)
    expect(useAppStore.getState()).toMatchObject({ activeView: 'workspaces', backTrail: ['calendar'] })
    expect(logo.getAttribute('aria-current')).toBe('page')
    fireEvent.click(logo)
    expect(useAppStore.getState().activeView).toBe('calendar')
  })

  it('puts the current workspace\'s picture in the big spot and the logo in the badge, and swaps back when the picture is missing', async () => {
    useAppStore.setState({ activeView: 'kanban', activeWorkspace: 'work', workspaceList: [{ slug: 'work', name: 'Work', color: '#10b981', icon: 'work-logo.webp' }] })
    await act(async () => { render(<Sidebar />) })
    const button = screen.getByRole('button', { name: 'Workspaces, current workspace Work' })
    const picture = button.querySelector('img[src^="checkpoint-media"]') as HTMLImageElement
    expect(picture.getAttribute('src')).toBe('checkpoint-media://work-logo.webp')
    expect(picture.style.width).toBe('32px')
    // the logo still there, now the small one in the corner
    expect(button.querySelectorAll('[alt="Checkpoint Logo"]')).toHaveLength(1)
    expect(button.textContent).not.toContain('W')

    fireEvent.error(picture)
    expect(button.querySelector('img[src^="checkpoint-media"]')).toBeNull()
    expect(button.querySelectorAll('[alt="Checkpoint Logo"]')).toHaveLength(1)
    expect(button.textContent).toContain('W')
  })

  it('keeps the logo big and the letter in the badge for a workspace with no picture', async () => {
    useAppStore.setState({ activeView: 'kanban', activeWorkspace: 'home', workspaceList: [{ slug: 'home', name: 'Home', color: '#10b981' }] })
    await act(async () => { render(<Sidebar />) })
    const button = screen.getByRole('button', { name: 'Workspaces, current workspace Home' })
    expect(button.querySelector('img[src^="checkpoint-media"]')).toBeNull()
    expect(button.textContent).toContain('H')
  })

  it('never remembers the Workspaces page as the view to start on', () => {
    const settings = vi.mocked(setStringSetting)
    settings.mockClear()
    useAppStore.getState().setView('workspaces')
    useAppStore.getState().setView('log')
    expect(settings.mock.calls.map(call => call[1])).toEqual(['log'])
  })

  it('does nothing when clicking the active tab', async () => {
    useAppStore.setState({ activeView: 'cheatsheets', backTrail: [] })
    await act(async () => { render(<Sidebar />) })
    const cheatsheets = screen.getByLabelText('Cheatsheets')
    expect(cheatsheets.getAttribute('aria-current')).toBe('page')

    fireEvent.click(cheatsheets)
    expect(useAppStore.getState().activeView).toBe('cheatsheets')
    expect(useAppStore.getState().backTrail).toEqual([])
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
