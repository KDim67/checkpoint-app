// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerConfetti } from '../src/renderer/src/lib/celebration'
import { buildCommands, type CommandContext } from '../src/renderer/src/lib/commands'

vi.mock('../src/renderer/src/lib/settings', () => {
  const store = new Map<string, unknown>()
  return {
    getBoolSetting: vi.fn(async (key: string, fallback = false) => {
      return store.has(key) ? (store.get(key) as boolean) : fallback
    }),
    setBoolSetting: vi.fn(async (key: string, val: boolean) => {
      store.set(key, val)
    }),
    _store: store
  }
})

vi.mock('../src/renderer/src/lib/presence', () => ({
  prefersReducedMotion: vi.fn(() => false)
}))

describe('triggerConfetti', () => {
  beforeEach(async () => {
    const settings = await import('../src/renderer/src/lib/settings')
    ;(settings as unknown as { _store: Map<string, unknown> })._store.clear()
    vi.clearAllMocks()
  })

  it('skips confetti if celebrations are disabled in settings', async () => {
    const settings = await import('../src/renderer/src/lib/settings')
    await settings.setBoolSetting('completion_celebrations_enabled', false)

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    await triggerConfetti()
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('shows first-time toast on first celebration and remembers it', async () => {
    const settings = await import('../src/renderer/src/lib/settings')
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    await triggerConfetti({ x: 100, y: 100 })

    expect(settings.setBoolSetting).toHaveBeenCalledWith('completion_celebrations_notified', true)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'checkpoint-toast'
      })
    )

    // Second trigger should not show the first-time toast again
    dispatchSpy.mockClear()
    await triggerConfetti({ x: 100, y: 100 })
    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})

describe('Fun & Utility Commands', () => {
  const dummyCtx: CommandContext = {
    setView: vi.fn(),
    setWorkspace: vi.fn(),
    setSettingsTab: vi.fn(),
    setRightPanelContent: vi.fn(),
    toggleRightPanel: vi.fn(),
    workspaces: ['default'],
    activeWorkspace: 'default',
    enabledViews: { kanban: true, wall: true, notes: true, backlog: true, settings: true },
    aiEnabled: true,
    savedViews: [],
    applyView: vi.fn(),
    create: vi.fn()
  }

  it('includes all fun command shortcuts in the command palette', () => {
    const cmds = buildCommands(dummyCtx)
    const funIds = cmds.filter(c => c.id.startsWith('fun:')).map(c => c.id)

    expect(funIds).toContain('fun:roll')
    expect(funIds).toContain('fun:flip')
    expect(funIds).toContain('fun:decide')
    expect(funIds).toContain('fun:confetti')
    expect(funIds).toContain('fun:shrug')
    expect(funIds).toContain('fun:tableflip')
    expect(funIds).toContain('fun:unflip')
    expect(funIds).toContain('fun:motivate')
  })

  it('executes /roll and produces roll toast', async () => {
    const cmds = buildCommands(dummyCtx)
    const rollCmd = cmds.find(c => c.id === 'fun:roll')
    expect(rollCmd).toBeDefined()

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    await rollCmd?.run()
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'checkpoint-toast'
      })
    )
  })

  it('executes /flip and produces heads or tails toast', async () => {
    const cmds = buildCommands(dummyCtx)
    const flipCmd = cmds.find(c => c.id === 'fun:flip')
    expect(flipCmd).toBeDefined()

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    await flipCmd?.run()
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'checkpoint-toast'
      })
    )
  })

  it('executes /shrug, /tableflip, /unflip', async () => {
    const cmds = buildCommands(dummyCtx)
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    await cmds.find(c => c.id === 'fun:shrug')?.run()
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'checkpoint-toast'
      })
    )

    await cmds.find(c => c.id === 'fun:tableflip')?.run()
    await cmds.find(c => c.id === 'fun:unflip')?.run()
  })
})
