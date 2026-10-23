// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { currentPart, partsIn } from '../src/renderer/src/components/settings/useSettingsParts'
import { useAppStore } from '../src/renderer/src/store/appStore'

vi.mock('../src/renderer/src/lib/settings', () => ({
  setStringSetting: vi.fn(async () => {})
}))

describe('the parts of a section', () => {
  it('are the marked areas on the page, a frame around other parts giving way to them', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-settings-part="AI Assistant"><div data-settings-part="Connection"></div><div data-settings-part="Memory"></div></div>'
      + '<div data-settings-part="Plugins"></div>'
    expect(partsIn(root).map(part => part.label)).toEqual(['Connection', 'Memory', 'Plugins'])
  })
})

describe('the part in view', () => {
  it('is the last whose top has reached the line', () => {
    expect(currentPart([100, 400, 900], 450, false)).toBe(1)
    expect(currentPart([-300, -50, 600], 120, false)).toBe(1)
  })

  it('is the first while none has reached it, and the first of two side by side', () => {
    expect(currentPart([300, 700], 120, false)).toBe(0)
    expect(currentPart([100, 100, 800], 120, false)).toBe(0)
  })

  it('is the last once the page is scrolled to its end, where it may never reach the line', () => {
    expect(currentPart([-400, 200, 500], 120, true)).toBe(2)
  })
})

describe('going back from Settings and the Workspaces page', () => {
  const go = useAppStore.getState().setView
  const back = (): void => useAppStore.getState().goBack()
  const view = (): string => useAppStore.getState().activeView

  it('retraces the way in, one page at a time', () => {
    useAppStore.setState({ activeView: 'calendar', backTrail: [] })
    go('settings')
    go('workspaces')
    back()
    expect(view()).toBe('settings')
    back()
    expect(view()).toBe('calendar')
    expect(useAppStore.getState().backTrail).toEqual([])
  })

  it('treats reaching a page already behind you as going back to it', () => {
    useAppStore.setState({ activeView: 'notes', backTrail: [] })
    go('settings')
    go('workspaces')
    go('settings')
    expect(useAppStore.getState().backTrail).toEqual(['notes'])
    back()
    expect(view()).toBe('notes')
  })

  it('forgets the way in once you go to work somewhere, and lands on the board with nothing behind', () => {
    useAppStore.setState({ activeView: 'log', backTrail: [] })
    go('settings')
    go('wall')
    expect(useAppStore.getState().backTrail).toEqual([])
    useAppStore.setState({ activeView: 'settings', backTrail: [] })
    back()
    expect(view()).toBe('kanban')
  })
})
