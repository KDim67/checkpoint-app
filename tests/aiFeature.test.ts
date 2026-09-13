import { describe, it, expect, vi } from 'vitest'
import { applyAiGate, AI_FEATURE_KEY, type ViewEnabledMap } from '../src/renderer/src/lib/features'
import { buildCommands, type CommandContext } from '../src/renderer/src/lib/commands'
import type { ActiveView } from '../src/renderer/src/store/appStore'

// gating the map is what makes one toggle cover sidebar, guard and palette

const allOn = (): ViewEnabledMap => ({
  kanban: true, log: true, backlog: true, focus: true, notes: true, wall: true,
  clipboard: true, analytics: true, cookbook: true, cheatsheets: true,
  gamedev: true, settings: true
} as ViewEnabledMap)

const context = (over: Partial<CommandContext> = {}): CommandContext => ({
  setView: vi.fn(),
  setWorkspace: vi.fn(),
  setSettingsTab: vi.fn(),
  setRightPanelContent: vi.fn(),
  toggleRightPanel: vi.fn(),
  workspaces: ['work'],
  activeWorkspace: 'work',
  enabledViews: allOn() as Partial<Record<ActiveView, boolean>>,
  savedViews: [],
  applyView: vi.fn(),
  aiEnabled: true,
  ...over
})

describe('the AI switch', () => {
  it('uses a key of its own, not a per-view flag', () => {
    expect(AI_FEATURE_KEY).toBe('feature_ai')
  })

  it('leaves every view alone while AI is on', () => {
    const map = allOn()
    expect(applyAiGate(map, true)).toBe(map)
  })

  it('takes the Cookbook with it, since that is a library of AI prompts', () => {
    expect(applyAiGate(allOn(), false).cookbook).toBe(false)
  })

  it('touches nothing else', () => {
    const gated = applyAiGate(allOn(), false)
    const others = Object.entries(gated).filter(([view]) => view !== 'cookbook')
    expect(others.every(([, on]) => on)).toBe(true)
  })

  it('does not mutate the map it was given', () => {
    // don't mutate the caller's map, it'd disable the Cookbook's own toggle
    const map = allOn()
    applyAiGate(map, false)
    expect(map.cookbook).toBe(true)
  })
})

describe('the command palette with AI off', () => {
  const idsFor = (aiEnabled: boolean): string[] =>
    buildCommands(context({ aiEnabled })).map(c => c.id)

  it('offers the assistant panel when AI is on', () => {
    expect(idsFor(true)).toContain('panel:ai')
  })

  it('does not offer it when AI is off', () => {
    // the palette would be a way back into a switched-off panel
    expect(idsFor(false)).not.toContain('panel:ai')
  })

  it('drops the AI settings tab too', () => {
    expect(idsFor(true).some(id => id.includes('ai'))).toBe(true)
    expect(idsFor(false).some(id => id === 'settings:ai')).toBe(false)
  })

  it('keeps every other panel and tab', () => {
    const off = idsFor(false)
    expect(off).toContain('panel:git')
    expect(off).toContain('settings:general')
  })

  it('still hides a view the user disabled, independently of AI', () => {
    const ids = buildCommands(context({
      aiEnabled: true,
      enabledViews: { ...allOn(), notes: false }
    })).map(c => c.id)
    expect(ids).not.toContain('view:notes')
  })
})
