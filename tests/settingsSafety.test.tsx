// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'
import { ConfirmProvider } from '../src/renderer/src/components/ui/ConfirmDialog'

const api = vi.hoisted(() => ({
  scanAndPrune: vi.fn(async () => ({ prunedCount: 2, spaceSavedBytes: 4096, prunedFiles: ['a.png', 'b.png'] })),
  updateTheme: vi.fn(async (..._args: unknown[]) => {}),
  deleteMemory: vi.fn(async (..._args: unknown[]) => {}),
  registerShortcuts: vi.fn(async (..._args: unknown[]) => {})
}))

vi.mock('../src/renderer/src/data/media', () => ({
  getStorageInfo: async () => ({ fileCount: 3, totalSize: 4096, path: 'C:\\media' }),
  scanAndPrune: api.scanAndPrune
}))
vi.mock('../src/renderer/src/data/exporter', () => ({ items: vi.fn() }))
vi.mock('../src/renderer/src/data/app', () => ({ openExternal: vi.fn(), platform: () => 'win32' }))
vi.mock('../src/renderer/src/data/customizer', () => ({
  getEngineState: async () => true,
  getTheme: async () => ({}),
  updateTheme: api.updateTheme,
  toggleEngine: vi.fn(async () => {}),
  getShortcuts: async () => ({}),
  registerShortcuts: api.registerShortcuts
}))
vi.mock('../src/renderer/src/data/memory', () => ({
  getMemories: async () => [{ id: 'm1', memory_key: 'antagonist', content: 'Chronos', category: 'semantic' }],
  saveMemory: vi.fn(),
  deleteMemory: api.deleteMemory
}))
vi.mock('../src/renderer/src/lib/settings', () => ({
  getStringSetting: async (_key: string, fallback: string) => fallback,
  setStringSetting: vi.fn(async () => {}),
  setJsonSetting: vi.fn(async () => {}),
  getEnumSetting: async (_key: string, _values: readonly string[], fallback: string) => fallback
}))
vi.mock('../src/renderer/src/lib/useAiEnabled', () => ({ useAiEnabled: () => true }))

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear()
})

afterEach(cleanup)

async function show(node: React.ReactNode): Promise<void> {
  await act(async () => { render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>) })
}

async function sayNo(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

describe('what can\'t be undone in Settings', () => {
  it('asks before deleting unused attachments, and deletes nothing when you say no', async () => {
    const { default: StorageSettings } = await import('../src/renderer/src/components/settings/StorageSettings')
    await show(<StorageSettings />)
    const cleanUp = await screen.findByRole('button', { name: 'Clean up…' })

    fireEvent.click(cleanUp)
    await sayNo()
    expect(api.scanAndPrune).not.toHaveBeenCalled()

    fireEvent.click(cleanUp)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete unused' }))
    await waitFor(() => expect(api.scanAndPrune).toHaveBeenCalledTimes(1))
  })

  it('asks before resetting every colour and the font', async () => {
    const { default: ThemeCustomizer } = await import('../src/renderer/src/components/settings/ThemeCustomizer')
    await show(<ThemeCustomizer />)
    const reset = await screen.findByRole('button', { name: 'Reset colours and font' })

    fireEvent.click(reset)
    await sayNo()
    expect(api.updateTheme).not.toHaveBeenCalled()

    fireEvent.click(reset)
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(api.updateTheme).toHaveBeenCalledWith({}))
  })

  it('asks before the assistant forgets something', async () => {
    const { default: MemoryVaultManager } = await import('../src/renderer/src/components/settings/MemoryVaultManager')
    await show(<MemoryVaultManager />)
    const forget = await screen.findByRole('button', { name: 'Forget antagonist' })

    fireEvent.click(forget)
    await sayNo()
    expect(api.deleteMemory).not.toHaveBeenCalled()

    fireEvent.click(forget)
    fireEvent.click(await screen.findByRole('button', { name: 'Forget' }))
    await waitFor(() => expect(api.deleteMemory).toHaveBeenCalledWith('m1'))
  })
})

describe('changing a shortcut', () => {
  async function record(label: string): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Change the shortcut for ${label},`) }))
    return screen.getByRole('textbox', { name: new RegExp(`^New shortcut for ${label}`) })
  }

  it('says why keys already in use were refused, under the shortcut you were changing', async () => {
    const { default: HotkeyBinder } = await import('../src/renderer/src/components/settings/HotkeyBinder')
    await show(<HotkeyBinder />)
    const field = await record('Go to Log')
    fireEvent.keyDown(field, { key: '2', code: 'Digit2', ctrlKey: true })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Ctrl+2 already does "Go to Kanban".')
    expect(within(alert.closest('li') as HTMLElement).getByText('Go to Log')).toBeTruthy()
  })

  it('keeps the shortcut it had when you click away', async () => {
    const { default: HotkeyBinder } = await import('../src/renderer/src/components/settings/HotkeyBinder')
    await show(<HotkeyBinder />)
    fireEvent.blur(await record('Go to Log'))
    expect(screen.queryByRole('textbox', { name: /^New shortcut for/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Change the shortcut for Go to Log, now Ctrl+1' })).toBeTruthy()
  })

  it('sets a global shortcut with Windows straight away, with no step to apply it and nothing else to switch on', async () => {
    const { default: HotkeyBinder } = await import('../src/renderer/src/components/settings/HotkeyBinder')
    await show(<HotkeyBinder />)
    const field = await record('Open quick capture')
    fireEvent.keyDown(field, { key: 'Q', code: 'KeyQ', altKey: true })

    await waitFor(() => expect(api.registerShortcuts).toHaveBeenCalledWith({ hud_toggle: 'Alt+Q', clipboard_toggle: 'Ctrl+Shift+V' }))
    expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull()
    expect(screen.queryByText(/Customization Engine/)).toBeNull()
  })
})

describe('release notes inside a page', () => {
  it('put their sections one level under the heading around them', async () => {
    const { default: ReleaseNotesBody } = await import('../src/renderer/src/components/ui/ReleaseNotesBody')
    render(<ReleaseNotesBody notes={'## Connections\n\nNew things.\n\n### Small fixes\n\nMore.'} level={3} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Connections' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 4, name: 'Small fixes' })).toBeTruthy()
  })
})
