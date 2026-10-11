// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const hud = vi.hoisted(() => ({
  hide: vi.fn(async () => {}),
  toggle: vi.fn(async () => {}),
  resize: vi.fn(),
  reset: null as (() => void) | null,
  created: [] as { item: Record<string, unknown>; tagIds: string[] }[]
}))

vi.mock('../src/renderer/src/data/hud', () => ({
  hide: hud.hide,
  toggle: hud.toggle,
  resize: hud.resize,
  onReset: (callback: () => void) => {
    hud.reset = callback
    return () => { hud.reset = null }
  }
}))
vi.mock('../src/renderer/src/data/items', () => ({
  createItem: vi.fn(async (item: Record<string, unknown>, tagIds: string[]) => { hud.created.push({ item, tagIds }) })
}))
vi.mock('../src/renderer/src/data/tags', () => ({
  listTags: vi.fn(async () => [{ id: 't1', name: 'ui', color: '#535e85' }, { id: 't2', name: 'urgent', color: '#a33' }]),
  resolveTagIds: vi.fn(async (wanted: { name: string }[]) => wanted.map(w => `id-${w.name}`))
}))
vi.mock('../src/renderer/src/lib/workspaceList', () => ({
  readWorkspaceList: vi.fn(async () => [
    { slug: 'default', name: 'Default', color: '#535e85' },
    { slug: 'work', name: 'Work', color: '#10b981' },
    { slug: 'wordle-clone', name: 'Wordle clone', color: '#d85a30' }
  ])
}))
vi.mock('../src/renderer/src/lib/settings', () => ({
  getStringSetting: vi.fn(async (key: string, fallback: string) => (key === 'active_context' ? 'work' : fallback))
}))

import HudView from '../src/renderer/src/components/HudView'

const input = (): HTMLInputElement => screen.getByRole('combobox', { name: 'Quick capture' }) as HTMLInputElement
const type = (text: string): void => {
  fireEvent.change(input(), { target: { value: text, selectionStart: text.length } })
}
const press = (key: string, init: KeyboardEventInit = {}): void => { fireEvent.keyDown(input(), { key, ...init }) }

beforeEach(() => {
  hud.hide.mockClear()
  hud.toggle.mockClear()
  hud.resize.mockClear()
  hud.created = []
  window.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void { this.callback([], this as unknown as ResizeObserver) }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
  window.AudioContext = undefined as unknown as typeof AudioContext
})

afterEach(cleanup)

async function open(): Promise<void> {
  await act(async () => { render(<HudView />) })
}

describe('the quick capture bar', () => {
  it('saves a log entry to the workspace you are in, and puts itself away without switching the hotkey off', async () => {
    await open()
    expect(screen.getByText('Work')).toBeTruthy()
    type('Called the bank')
    press('Enter')
    await waitFor(() => expect(hud.hide).toHaveBeenCalled())
    expect(hud.created[0].item).toMatchObject({ type: 'log', context: 'work', title: 'Called the bank' })
    expect(hud.toggle).not.toHaveBeenCalled()
  })

  it('closes on Escape the same way, leaving the hotkey on', async () => {
    await open()
    press('Escape')
    expect(hud.hide).toHaveBeenCalled()
    expect(hud.toggle).not.toHaveBeenCalled()
  })

  it('switches between a log entry and a task with Tab, and a leading "- " switches back off with it', async () => {
    await open()
    const kind = (): string => screen.getByRole('button', { name: /^Saving a/ }).textContent ?? ''
    expect(kind()).toContain('Log')
    press('Tab')
    expect(kind()).toContain('Task')
    press('Tab')
    type('- Pay rent')
    expect(kind()).toContain('Task')
    press('Tab')
    expect(input().value).toBe('Pay rent')
    expect(kind()).toContain('Log')
  })

  it('offers your workspaces as you type @, and Enter takes the one picked', async () => {
    await open()
    type('Fix the banner @wo')
    const options = screen.getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['Workcurrent', 'Wordle clone'])
    expect(input().getAttribute('aria-activedescendant')).toBe(options[0].id)
    press('ArrowDown')
    press('Enter')
    expect(input().value).toBe('Fix the banner @wordle-clone ')
    expect(screen.queryByRole('listbox')).toBeNull()
    press('Enter')
    await waitFor(() => expect(hud.created[0]?.item).toMatchObject({ context: 'wordle-clone', title: 'Fix the banner' }))
  })

  it('offers your tags as you type #', async () => {
    await open()
    type('Fix #u')
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['#ui', '#urgent'])
  })

  it('closes the list on Escape and stays open itself', async () => {
    await open()
    type('Fix @wo')
    press('Escape')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(hud.hide).not.toHaveBeenCalled()
  })

  it('saves @Work into the real "work", not a workspace by that spelling', async () => {
    await open()
    type('- Plan @Work ')
    press('Enter')
    await waitFor(() => expect(hud.created[0]?.item).toMatchObject({ type: 'task', context: 'work' }))
  })

  it('says a workspace does not exist while it is typed, and refuses to save there', async () => {
    await open()
    type('Bake the lighting @unity')
    expect(screen.getByText('No workspace called “unity”')).toBeTruthy()
    type('Bake the lighting @unity ')
    press('Enter')
    expect(screen.getByRole('alert').textContent).toContain('There\'s no workspace called "unity"')
    expect(hud.created).toEqual([])
  })

  it('reads back what gets made before saving', async () => {
    await open()
    type('- Ship it #ui !high tomorrow 3pm')
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText('ui')).toBeTruthy()
    expect(screen.getByText(/save to Work/)).toBeTruthy()
  })

  it('asks for something to save rather than saving nothing', async () => {
    await open()
    press('Enter')
    expect(screen.getByRole('alert').textContent).toContain('Type something to save first.')
    expect(hud.created).toEqual([])
  })

  it('empties itself when main puts it away', async () => {
    await open()
    press('Tab')
    type('half a thought')
    act(() => hud.reset?.())
    expect(input().value).toBe('')
    expect(screen.getByRole('button', { name: /^Saving a/ }).textContent).toContain('Log')
  })

  it('asks for a window as tall as what it shows', async () => {
    await open()
    expect(hud.resize).toHaveBeenCalled()
  })
})
