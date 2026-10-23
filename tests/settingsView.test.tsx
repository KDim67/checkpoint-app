// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useState } from 'react'

const env = vi.hoisted(() => ({ platform: 'win32', ai: true }))

vi.mock('../src/renderer/src/data/app', () => ({ platform: () => env.platform }))
vi.mock('../src/renderer/src/lib/useAiEnabled', () => ({ useAiEnabled: () => env.ai }))
vi.mock('../src/renderer/src/lib/settings', () => ({ setStringSetting: vi.fn(async () => {}) }))

// each section stands in for itself with just enough of its page to be found
vi.mock('../src/renderer/src/components/settings/GeneralSettings', () => ({
  default: () => <div className="row"><label htmlFor="start-view">Startup View</label><select id="start-view"><option>Log</option></select></div>
}))
vi.mock('../src/renderer/src/components/settings/StartupSettings', () => ({
  default: () => <div className="row"><div>Start with Windows</div><button role="switch" aria-label="Start with Windows" /></div>
}))
vi.mock('../src/renderer/src/components/settings/WidgetSettings', () => ({ default: () => <div>Show Desktop Widget</div> }))
// loads after it opens, as the real one does
vi.mock('../src/renderer/src/components/settings/HotkeyBinder', () => ({
  default: function HotkeyBinder() {
    const [ready, setReady] = useState(false)
    useEffect(() => {
      const timer = setTimeout(() => setReady(true), 30)
      return () => clearTimeout(timer)
    }, [])
    if (!ready) return <p>Loading…</p>
    return (
      <div>
        <div data-settings-part="Global Shortcuts"><h4>Global Shortcuts</h4></div>
        <div data-settings-part="View Shortcuts">
          <span>Wall</span>
          <div className="row"><span>Select</span><button id="wall-select">V</button></div>
          <span>Kanban card</span>
          <div className="row"><span>Mark done</span><button id="mark-done">X</button></div>
        </div>
      </div>
    )
  }
}))
for (const name of ['SyncSettings', 'NotificationSettings', 'McpSettings', 'ConnectionsSettings', 'AppearanceSettings', 'FeatureToggleCenter', 'AboutPanel', 'ThemeCustomizer', 'ExtensionsTab', 'KanbanSettings', 'AiSettings', 'ThemeModeSettings', 'BackupSettings', 'StorageSettings']) {
  vi.doMock(`../src/renderer/src/components/settings/${name}`, () => ({ default: () => <div>{name}</div> }))
}

const { default: SettingsView } = await import('../src/renderer/src/components/SettingsView')
const { useAppStore } = await import('../src/renderer/src/store/appStore')

const search = (): HTMLInputElement => screen.getByRole('searchbox', { name: 'Search settings' }) as HTMLInputElement
const type = (text: string): void => { fireEvent.change(search(), { target: { value: text } }) }
const press = (key: string, init: KeyboardEventInit = {}): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
}

beforeEach(() => {
  env.platform = 'win32'
  env.ai = true
  Element.prototype.scrollTo = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
  useAppStore.setState({ activeView: 'settings', backTrail: ['calendar'], settingsTab: 'general', activeWorkspace: 'work' })
})

afterEach(cleanup)

async function open(): Promise<void> {
  await act(async () => { render(<SettingsView />) })
}

describe('searching settings', () => {
  it('opens the section a setting is in and lands on it once the section has loaded', async () => {
    await open()
    type('mark done')
    const results = screen.getByRole('list', { name: 'Matching settings' })
    expect(within(results).getAllByRole('button')[0].getAttribute('aria-label')).toBe('Mark done, Shortcuts & Mouse · Kanban card')
    search().focus()
    press('Enter')

    expect(useAppStore.getState().settingsTab).toBe('hotkeyBinder')
    expect(search().value).toBe('')
    await waitFor(() => expect(document.activeElement?.id).toBe('mark-done'))
    expect(document.activeElement?.parentElement?.classList.contains('settings-found')).toBe(true)
  })

  it('lands under the right heading when two sections of the page share the words', async () => {
    useAppStore.setState({ settingsTab: 'hotkeyBinder' })
    await open()
    await screen.findByText('Mark done')
    type('wall select')
    fireEvent.click(screen.getByRole('button', { name: 'Select, Shortcuts & Mouse · Wall' }))
    await waitFor(() => expect(document.activeElement?.id).toBe('wall-select'))
  })

  it('opens a whole section from its name, focus on its title', async () => {
    await open()
    type('device sync')
    fireEvent.click(screen.getByRole('button', { name: 'Device Sync, System' }))
    expect(useAppStore.getState().settingsTab).toBe('sync')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Device Sync' }))
    expect(Element.prototype.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' })
  })

  it('walks the results with the arrows, and typing there goes back to the search', async () => {
    await open()
    type('theme')
    const buttons = within(screen.getByRole('list', { name: 'Matching settings' })).getAllByRole('button')
    search().focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(buttons[0])
    press('ArrowDown')
    expect(document.activeElement).toBe(buttons[1])
    press('ArrowUp')
    press('ArrowUp')
    expect(document.activeElement).toBe(search())
    press('ArrowDown')
    press('s')
    expect(search().value).toBe('themes')
    expect(document.activeElement).toBe(search())
  })

  it('says so when nothing matches, and suggests other words', async () => {
    await open()
    type('zzzz')
    expect(screen.getByText(/Nothing matches “zzzz”/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('No settings found')
  })

  it('leaves out what this computer or a switched off AI never shows', async () => {
    env.platform = 'linux'
    env.ai = false
    await open()
    type('start with windows')
    expect(screen.queryByRole('list', { name: 'Matching settings' })).toBeNull()
    type('temperature')
    expect(screen.queryByRole('list', { name: 'Matching settings' })).toBeNull()
    type('ai assistant')
    const found = within(screen.getByRole('list', { name: 'Matching settings' })).getAllByRole('button').map(b => b.getAttribute('aria-label'))
    // the switch that turns it back on, never the section it hides
    expect(found[0]).toBe('AI Assistant, Features & Plugins')
    expect(found).not.toContain('AI Assistant, Workspace')
  })

  it('stops looking once you open another section yourself, so it never jumps you there later', async () => {
    await open()
    type('mark done')
    search().focus()
    press('Enter')
    fireEvent.click(screen.getByRole('button', { name: 'General' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shortcuts & Mouse' }))
    await screen.findByText('Mark done')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(document.activeElement?.id).not.toBe('mark-done')
    expect(document.querySelector('.settings-found')).toBeNull()
  })

  it('goes to the search with Ctrl+F', async () => {
    await open()
    press('f', { ctrlKey: true })
    expect(document.activeElement).toBe(search())
  })
})

describe('the open section\'s parts', () => {
  it('are listed under it and each jumps to its part', async () => {
    await open()
    const parts = screen.getByRole('list', { name: 'In General' })
    expect(within(parts).getAllByRole('button').map(b => b.textContent)).toEqual(['Startup', 'Tray & Windows Startup', 'Desktop Widget'])
    fireEvent.click(within(parts).getByRole('button', { name: 'Desktop Widget' }))
    expect(within(parts).getByRole('button', { name: 'Desktop Widget' }).getAttribute('aria-current')).toBe('location')
    expect((document.activeElement as HTMLElement).dataset.settingsPart).toBe('Desktop Widget')
    // lit too, for a screen tall enough that nothing had to scroll
    expect(document.activeElement?.classList.contains('settings-found')).toBe(true)
  })

  it('fold shut when you leave, out of reach of the keyboard and screen readers', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Shortcuts & Mouse' }))
    expect(screen.queryByRole('list', { name: 'In General' })).toBeNull()
    const folded = screen.getByRole('list', { name: 'In General', hidden: true })
    expect(folded.closest('.settings-parts-wrap')?.hasAttribute('data-open')).toBe(false)
    expect(within(folded).getAllByRole('button', { hidden: true }).map(button => button.tabIndex)).toEqual([-1, -1, -1])
  })

  it('are left out for a section that is one part', async () => {
    env.platform = 'linux'
    await open()
    expect(screen.queryByRole('list', { name: 'In General' })).toBeNull()
  })

  it('appear once a section that loads late has drawn them', async () => {
    useAppStore.setState({ settingsTab: 'hotkeyBinder' })
    await open()
    expect(screen.queryByRole('list', { name: 'In Shortcuts & Mouse' })).toBeNull()
    const parts = await screen.findByRole('list', { name: 'In Shortcuts & Mouse' })
    expect(within(parts).getAllByRole('button').map(b => b.textContent)).toEqual(['Global Shortcuts', 'View Shortcuts'])
  })
})

describe('leaving Settings', () => {
  it('works with Escape straight away, back to where you were', async () => {
    await open()
    expect(document.activeElement?.classList.contains('settings-view')).toBe(true)
    press('Escape')
    expect(useAppStore.getState().activeView).toBe('calendar')
  })

  it('empties the search before leaving', async () => {
    await open()
    type('theme')
    search().focus()
    press('Escape')
    expect(search().value).toBe('')
    expect(useAppStore.getState().activeView).toBe('settings')
    press('Escape')
    expect(useAppStore.getState().activeView).toBe('calendar')
  })

  it('leaves Escape to a dialog open over it', async () => {
    await open()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    press('Escape')
    dialog.remove()
    expect(useAppStore.getState().activeView).toBe('settings')
  })

  it('has a close button that does the same', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(useAppStore.getState().activeView).toBe('calendar')
  })
})
