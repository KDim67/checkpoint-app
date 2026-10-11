import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const registered = new Set<string>()
  const windows: { visible: boolean; sizes: [number, number][]; destroyed: boolean }[] = []
  class BrowserWindow {
    private readonly state = { visible: false, sizes: [] as [number, number][], destroyed: false }
    webContents = { send: vi.fn() }
    constructor() { windows.push(this.state) }
    on(): void {}
    loadURL(): void {}
    loadFile(): void {}
    show(): void { this.state.visible = true }
    focus(): void {}
    hide(): void { this.state.visible = false }
    isVisible(): boolean { return this.state.visible }
    setSize(): void { throw new Error('setSize never shrinks a transparent fixed-size window') }
    setContentSize(width: number, height: number): void { this.state.sizes.push([width, height]) }
    destroy(): void { this.state.destroyed = true }
  }
  return {
    handlers,
    registered,
    windows,
    module: {
      BrowserWindow,
      globalShortcut: {
        register: (key: string) => { registered.add(key); return true },
        unregister: (key: string) => { registered.delete(key) }
      },
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
        on: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) }
      }
    }
  }
})

const settings = vi.hoisted(() => new Map<string, string>())

vi.mock('electron', () => ({ ...electron.module, default: electron.module }))
vi.mock('../src/main/db', () => ({ getSetting: (key: string, fallback: string) => settings.get(key) ?? fallback }))
vi.mock('../src/main/windows', () => ({ getMainWindow: () => null }))

import { registerHudHandlers } from '../src/main/ipc/hud'
import { IpcChannels } from '../src/shared/ipcChannels'
import { enableHud, resizeHud, showHud } from '../src/main/hud'

const call = (channel: string, ...args: unknown[]): unknown => electron.handlers.get(channel)?.({}, ...args)

beforeEach(() => {
  settings.clear()
  registerHudHandlers()
})

describe('putting quick capture away', () => {
  it('hides the bar and clears it, keeping the hotkey that brings it back', async () => {
    enableHud('CommandOrControl+Shift+Space')
    showHud()
    const shown = electron.windows[electron.windows.length - 1]
    await call(IpcChannels.HUD_HIDE)
    expect(shown.visible).toBe(false)
    expect(shown.destroyed).toBe(false)
    expect(electron.registered.has('CommandOrControl+Shift+Space')).toBe(true)
  })

  it('uses the key you bound with your customizations off, since picking a light or dark theme switches them off', async () => {
    settings.set('customizer_shortcuts', JSON.stringify({ hud_toggle: 'Alt+W' }))
    await call(IpcChannels.HUD_TOGGLE, false)
    await call(IpcChannels.HUD_TOGGLE, true)
    expect(electron.registered.has('Alt+W')).toBe(true)
    expect(electron.registered.has('CommandOrControl+Shift+Space')).toBe(false)
  })

  it('turns back on with the key you bound, not the default', async () => {
    settings.set('customizer_enabled', 'true')
    settings.set('customizer_shortcuts', JSON.stringify({ hud_toggle: 'Alt+Q' }))
    await call(IpcChannels.HUD_TOGGLE, false)
    await call(IpcChannels.HUD_TOGGLE, true)
    expect(electron.registered.has('Alt+Q')).toBe(true)
    expect(electron.registered.has('CommandOrControl+Shift+Space')).toBe(false)
  })
})

describe('sizing the bar', () => {
  it('follows what it shows, but never past the bar alone or a long list, and ignores a bad ask', () => {
    enableHud('Alt+Q')
    const bar = electron.windows[electron.windows.length - 1]
    bar.sizes.length = 0
    resizeHud(131.6)
    resizeHud(5)
    resizeHud(5000)
    resizeHud(Number.NaN)
    resizeHud('tall' as unknown as number)
    expect(bar.sizes).toEqual([[600, 132], [600, 64], [600, 420]])
  })
})
