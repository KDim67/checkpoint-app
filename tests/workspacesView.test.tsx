// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ActivityBySlug } from '../src/shared/workspaceLanes'

// the Workspaces page as someone uses it: switching, the keyboard, reordering, filtering, and each change from the menu

const store = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  activity: {} as Record<string, unknown>,
  counts: { card: 2, task: 3 } as Record<string, number>,
  renamed: [] as [string, string][],
  imported: [] as [string, unknown][],
  exported: [] as string[],
  importFile: null as unknown
}))

vi.mock('../src/renderer/src/data/settings', () => ({
  getSetting: vi.fn(async (key: string) => store.settings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: unknown) => { store.settings.set(key, value) }),
  deleteSetting: vi.fn(async (key: string) => { store.settings.delete(key) })
}))
vi.mock('../src/renderer/src/data/items', () => ({
  countItems: vi.fn(async (_slug: string, type: string) => store.counts[type] ?? 0),
  createItem: vi.fn(async () => ({ id: 'made' }))
}))
vi.mock('../src/renderer/src/data/tags', () => ({ createTag: vi.fn(async () => ({ id: 'tag' })) }))
vi.mock('../src/renderer/src/data/workspaceFolder', () => ({ selectFolder: vi.fn(async () => 'C:/projects/site') }))
vi.mock('../src/renderer/src/data/workspaces', () => ({
  getContexts: vi.fn(async () => []),
  workspaceActivity: vi.fn(async () => store.activity),
  exportContext: vi.fn(async (slug: string) => { store.exported.push(slug); return { success: true, filePath: `C:/out/${slug}-workspace.json` } }),
  importContext: vi.fn(async () => store.importFile),
  importContextData: vi.fn(async (slug: string, payload: unknown) => { store.imported.push([slug, payload]); return { success: true } }),
  renameContext: vi.fn(async (from: string, to: string) => { store.renamed.push([from, to]); return { success: true } })
}))

// a canvas isn't here to draw on, so the picture is "stored" by name; the cropping has tests of its own
vi.mock('../src/renderer/src/lib/workspaceIcon', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/renderer/src/lib/workspaceIcon')>()),
  storeWorkspaceIcon: vi.fn(async (file: File) => {
    if (file.name === 'broken.png') throw new Error("That image couldn't be converted.")
    return 'icon-1.webp'
  })
}))

import WorkspacesView from '../src/renderer/src/components/workspaces/WorkspacesView'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'
import { useAppStore } from '../src/renderer/src/store/appStore'
import { allDay } from '../src/shared/dueDate'

const LIST = [
  { slug: 'work', name: 'Work', color: '#1e45fc', gitPath: 'C:/code/checkpoint-app', icon: 'work-logo.webp' },
  { slug: 'client', name: 'Client site', color: '#10b981', shared: true },
  { slug: 'thesis', name: 'Thesis', color: '#8b5cf6' }
]

const dayFromToday = (offset: number): number => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return allDay({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate() })
}

const savedList = (): { slug: string; name: string }[] => JSON.parse(store.settings.get('contexts_list') as string)
const lanes = (): HTMLElement[] => screen.getAllByRole('listitem')
const laneButton = (name: string): HTMLElement => screen.getByRole('button', { name: new RegExp(`^${name},`) })

beforeEach(() => {
  store.settings = new Map([['contexts_list', JSON.stringify(LIST)]])
  store.activity = {
    work: {
      open: 3,
      dated: [
        { id: 't1', type: 'task', title: 'Fix the login', due: dayFromToday(-1) },
        { id: 't2', type: 'task', title: 'Ship it', due: dayFromToday(1) }
      ],
      focus: [{ at: Date.now() - 60_000, ms: 30 * 60_000 }],
      lastChanged: { id: 'card-9', type: 'card', title: 'Crop handles keep their size', at: Date.now() - 12 * 60_000 }
    }
  } satisfies ActivityBySlug
  store.renamed = []
  store.imported = []
  store.exported = []
  store.importFile = null
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0)
  useAppStore.setState({
    activeView: 'workspaces',
    backTrail: ['backlog'],
    activeWorkspace: 'work',
    availableWorkspaces: LIST.map(e => e.slug),
    workspaceList: [],
    pendingCreate: null,
    selectedItemId: null
  })
})

afterEach(() => {
  cleanup()
})

async function openPage(): Promise<void> {
  render(<ToastProvider><WorkspacesView /></ToastProvider>)
  await screen.findByText('Crop handles keep their size')
}

describe('the lanes', () => {
  it('shows every workspace in order, the current one marked, with what is open, late and last changed', async () => {
    await openPage()
    expect(lanes().map(lane => within(lane).getAllByRole('button')[0].textContent)).toEqual(['Work', 'Client site', 'Thesis'])
    const work = lanes()[0]
    expect(within(work).getByText('here')).toBeTruthy()
    expect(within(work).getByText('3 open')).toBeTruthy()
    expect(within(work).getByText('1 late')).toBeTruthy()
    expect(within(work).getByText('checkpoint-app')).toBeTruthy()
    expect(within(lanes()[1]).getByText('shared')).toBeTruthy()
    expect(within(lanes()[2]).getByText('Nothing in it yet')).toBeTruthy()
  })

  it('says everything the strip shows in each lane\'s name, for a screen reader', async () => {
    await openPage()
    expect(laneButton('Work').getAttribute('aria-label')).toMatch(/^Work, current workspace, 3 open, 1 late, 0 due today, \d+ minutes? this week$|^Work, current workspace, 3 open, 1 late, 0 due today, no focus time this week$/)
    expect(laneButton('Thesis').getAttribute('aria-label')).toBe('Thesis, nothing open, no focus time this week')
  })

  it('draws two weeks either side of today, a late item as a square on its day and a due one as a dot', async () => {
    await openPage()
    const strip = lanes()[0].querySelector('.ws-days') as HTMLElement
    expect(strip.querySelectorAll('.ws-day')).toHaveLength(28)
    expect(strip.querySelector('[data-offset="0"]')?.classList.contains('ws-day-today')).toBe(true)
    expect(strip.querySelector('[data-offset="-1"] .ws-mark-late')).toBeTruthy()
    expect(strip.querySelector('[data-offset="1"] .ws-mark:not(.ws-mark-late)')).toBeTruthy()
    expect(strip.querySelector('[data-offset="0"] .ws-day-bar')).toBeTruthy()
  })

  it('says what is behind a day when it is hovered', async () => {
    await openPage()
    fireEvent.mouseEnter(lanes()[0].querySelector('[data-offset="-1"]') as HTMLElement)
    expect(await screen.findByText('Yesterday')).toBeTruthy()
    const tip = document.querySelector('.ws-tip') as HTMLElement
    expect(within(tip).getByText('Fix the login')).toBeTruthy()
    expect(within(tip).getByText('late')).toBeTruthy()
  })
})

describe('switching', () => {
  it('switches on a click anywhere on a lane and goes back to where you came from', async () => {
    await openPage()
    fireEvent.click(lanes()[2].querySelector('.ws-strip') as HTMLElement)
    expect(useAppStore.getState()).toMatchObject({ activeWorkspace: 'thesis', activeView: 'backlog' })
  })

  it('lands on the current lane, moves with the arrows and switches with Enter', async () => {
    await openPage()
    await waitFor(() => expect(document.activeElement).toBe(laneButton('Work')))
    fireEvent.keyDown(laneButton('Work'), { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(laneButton('Client site')))
    expect(laneButton('Client site').tabIndex).toBe(0)
    expect(laneButton('Work').tabIndex).toBe(-1)
    fireEvent.click(laneButton('Client site'))
    expect(useAppStore.getState().activeWorkspace).toBe('client')
  })

  it('opens the last thing changed, in its workspace and its own view', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: /^Open the last thing changed in Work/ }))
    expect(useAppStore.getState()).toMatchObject({ activeWorkspace: 'work', activeView: 'kanban', selectedItemId: 'card-9', rightPanelContent: 'item-detail' })
  })

  it('goes back on Escape, first clearing a filter', async () => {
    await openPage()
    const filter = screen.getByRole('searchbox')
    fireEvent.change(filter, { target: { value: 'the' } })
    fireEvent.keyDown(filter, { key: 'Escape' })
    expect((filter as HTMLInputElement).value).toBe('')
    expect(useAppStore.getState().activeView).toBe('workspaces')
    fireEvent.keyDown(filter, { key: 'Escape' })
    expect(useAppStore.getState().activeView).toBe('backlog')
  })
})

describe('the keys', () => {
  const selected = (): string | null | undefined => lanes().find(lane => lane.dataset.selected === 'true')?.querySelector('.ws-lane-switch')?.textContent
  const keyHints = (): string => document.querySelector('.ws-keys')?.textContent ?? ''

  it('work after a click beside the lanes leaves nothing focused, on the lane shown as selected', async () => {
    await openPage()
    await waitFor(() => expect(document.activeElement).toBe(laneButton('Work')))
    expect(selected()).toBe('Work')
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(selected()).toBe('Client site')
    await waitFor(() => expect(document.activeElement).toBe(laneButton('Client site')))
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(useAppStore.getState()).toMatchObject({ activeWorkspace: 'client', activeView: 'backlog' })
  })

  it("work after a click on the page's empty space, which focuses the page itself", async () => {
    await openPage()
    const page = document.querySelector('.ws-page') as HTMLElement
    page.focus()
    fireEvent.keyDown(page, { key: 'ArrowDown', altKey: true })
    await waitFor(() => expect(savedList().map(e => e.slug)).toEqual(['client', 'work', 'thesis']))
    page.focus()
    fireEvent.keyDown(page, { key: 'Escape' })
    expect(useAppStore.getState().activeView).toBe('backlog')
  })

  it("are listed with what each does right now, leaving out what can't be done", async () => {
    await openPage()
    await waitFor(() => expect(document.activeElement).toBe(laneButton('Work')))
    expect(keyHints()).toContain('Stay in Work')
    expect(keyHints()).toContain('Move')
    expect(keyHints()).toContain('Back')
    fireEvent.keyDown(laneButton('Work'), { key: 'ArrowDown' })
    expect(keyHints()).toContain('Switch to Client site')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'th' } })
    expect(keyHints()).toContain('Switch to Thesis')
    expect(keyHints()).toContain('Clear filter')
    expect(keyHints()).not.toContain('Move')
  })

  it('switch to the selected lane from the filter too', async () => {
    await openPage()
    await waitFor(() => expect(document.activeElement).toBe(laneButton('Work')))
    fireEvent.keyDown(laneButton('Work'), { key: 'End' })
    expect(selected()).toBe('Thesis')
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })
    expect(useAppStore.getState().activeWorkspace).toBe('thesis')
  })

  it("leave a dialog's keys to the dialog", async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    await screen.findByLabelText('Name')
    fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    expect(savedList().map(e => e.slug)).toEqual(['work', 'client', 'thesis'])
    expect(useAppStore.getState().activeView).toBe('workspaces')
  })
})

describe("a workspace's picture", () => {
  const choose = (name: string): void => {
    fireEvent.change(screen.getByTestId('ws-form-image-file'), { target: { files: [new File(['x'], name, { type: 'image/png' })] } })
  }
  const tileImage = (lane: HTMLElement): HTMLImageElement | null => lane.querySelector('.ws-spine img')

  it('shows on its lane instead of the letter, and the letter comes back if the picture is missing', async () => {
    await openPage()
    const image = tileImage(lanes()[0]) as HTMLImageElement
    expect(image.getAttribute('src')).toBe('checkpoint-media://work-logo.webp')
    expect(tileImage(lanes()[1])).toBeNull()
    expect(lanes()[1].querySelector('.ws-spine')?.textContent).toBe('C')
    fireEvent.error(image)
    expect(tileImage(lanes()[0])).toBeNull()
    expect(lanes()[0].querySelector('.ws-spine')?.textContent).toBe('W')
  })

  it('is chosen in the new workspace form, previewed there, and kept with the workspace', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Garden' } })
    choose('garden.png')
    await waitFor(() => expect(screen.getByRole('dialog').querySelector('.ws-spine img')?.getAttribute('src')).toBe('checkpoint-media://icon-1.webp'))
    expect(screen.getByRole('button', { name: 'Change image…' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    await waitFor(() => expect(savedList().find(e => e.slug === 'garden')).toMatchObject({ icon: 'icon-1.webp' }))
  })

  it('can be taken off in the edit form, leaving the letter', async () => {
    await openPage()
    fireEvent.click(within(lanes()[0]).getByRole('button', { name: 'More for Work' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename and colour' }))
    await screen.findByLabelText('Name')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('dialog').querySelector('.ws-spine img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedList()[0]).not.toHaveProperty('icon'))
  })

  it('says why a picture was refused, next to it, and the workspace can still be made without one', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Garden' } })
    choose('broken.png')
    expect((await screen.findByRole('alert')).textContent).toBe("That image couldn't be converted.")
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    await waitFor(() => expect(savedList().find(e => e.slug === 'garden')).not.toHaveProperty('icon'))
  })
})

describe('reordering', () => {
  it('moves the focused lane with Alt and the arrows, saves the order and keeps the focus on it', async () => {
    await openPage()
    await waitFor(() => expect(document.activeElement).toBe(laneButton('Work')))
    fireEvent.keyDown(laneButton('Work'), { key: 'ArrowDown', altKey: true })
    await waitFor(() => expect(savedList().map(e => e.slug)).toEqual(['client', 'work', 'thesis']))
    await waitFor(() => expect(document.activeElement).toBe(laneButton('Work')))
    expect(useAppStore.getState().availableWorkspaces).toEqual(['client', 'work', 'thesis'])
  })

  it('moves one up or down from its menu, offering only the ways it can go', async () => {
    await openPage()
    fireEvent.click(within(lanes()[0]).getByRole('button', { name: 'More for Work' }))
    expect(screen.queryByRole('menuitem', { name: 'Move up' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }))
    await waitFor(() => expect(savedList().map(e => e.slug)).toEqual(['client', 'work', 'thesis']))
    fireEvent.click(within(lanes()[2]).getByRole('button', { name: 'More for Thesis' }))
    expect(screen.queryByRole('menuitem', { name: 'Move down' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeTruthy()
  })

  it('leaves the order alone while the list is filtered', async () => {
    await openPage()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 's' } })
    fireEvent.keyDown(laneButton('Client site'), { key: 'ArrowDown', altKey: true })
    await act(async () => { await Promise.resolve() })
    expect(savedList().map(e => e.slug)).toEqual(['work', 'client', 'thesis'])
  })
})

describe('filtering', () => {
  it('sends typing on a lane to the filter, and Enter there switches to the first match', async () => {
    await openPage()
    await waitFor(() => expect(document.activeElement).toBe(laneButton('Work')))
    fireEvent.keyDown(laneButton('Work'), { key: 't' })
    const filter = screen.getByRole('searchbox') as HTMLInputElement
    expect(filter.value).toBe('t')
    expect(document.activeElement).toBe(filter)
    fireEvent.change(filter, { target: { value: 'th' } })
    expect(lanes().map(lane => within(lane).getAllByRole('button')[0].textContent)).toEqual(['Thesis'])
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(useAppStore.getState().activeWorkspace).toBe('thesis')
  })

  it('offers to create what was typed when nothing matches', async () => {
    await openPage()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Garden' } })
    expect(screen.getByText('No workspace matches “Garden”.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create “Garden”' }))
    expect((await screen.findByLabelText('Name') as HTMLInputElement).value).toBe('Garden')
  })
})

describe('making and changing workspaces', () => {
  it('creates one, switches to it and goes back', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Garden plans' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    await waitFor(() => expect(useAppStore.getState()).toMatchObject({ activeWorkspace: 'garden-plans', activeView: 'backlog' }))
    expect(savedList().map(e => e.slug)).toEqual(['work', 'client', 'thesis', 'garden-plans'])
  })

  it('opens the new workspace form when the palette or a view asked for it', async () => {
    useAppStore.setState({ pendingCreate: 'workspace' })
    await openPage()
    expect(await screen.findByRole('heading', { name: 'New workspace' })).toBeTruthy()
    expect(useAppStore.getState().pendingCreate).toBeNull()
  })

  it('says why a name is refused, next to the name', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Thesis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    expect((await screen.findByRole('alert')).textContent).toBe('There\'s already a workspace called "thesis".')
  })

  it('renames one from its menu, moving its data when the short name changes, and the current workspace follows', async () => {
    await openPage()
    fireEvent.click(within(lanes()[0]).getByRole('button', { name: 'More for Work' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename and colour' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Day job' } })
    fireEvent.change(screen.getByLabelText('Short name'), { target: { value: 'day-job' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(store.renamed).toEqual([['work', 'day-job']]))
    await waitFor(() => expect(savedList()[0]).toMatchObject({ slug: 'day-job', name: 'Day job' }))
    expect(useAppStore.getState().activeWorkspace).toBe('day-job')
  })

  it('opens the same form on the folder for Linked repository', async () => {
    await openPage()
    fireEvent.click(within(lanes()[2]).getByRole('button', { name: 'More for Thesis' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Linked repository' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Repository folder')))
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }))
    await waitFor(() => expect((screen.getByLabelText('Repository folder') as HTMLInputElement).value).toBe('C:/projects/site'))
  })

  it('removes one after saying its items stay, and Undo puts it back in its place', async () => {
    await openPage()
    fireEvent.click(within(lanes()[1]).getByRole('button', { name: 'More for Client site' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove workspace' }))
    expect(await screen.findByText(/Its 5 cards and tasks stay in the database/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(savedList().map(e => e.slug)).toEqual(['work', 'thesis']))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(savedList().map(e => e.slug)).toEqual(['work', 'client', 'thesis']))
  })

  it('offers no way to remove the only workspace', async () => {
    store.settings.set('contexts_list', JSON.stringify([LIST[0]]))
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'More for Work' }))
    expect(screen.queryByRole('menuitem', { name: 'Remove workspace' })).toBeNull()
  })

  it('clears the shared label from the menu, and offers it only for a shared one', async () => {
    await openPage()
    fireEvent.click(within(lanes()[0]).getByRole('button', { name: 'More for Work' }))
    expect(screen.queryByRole('menuitem', { name: 'Stop sharing' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.click(within(lanes()[1]).getByRole('button', { name: 'More for Client site' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop sharing' }))
    await waitFor(() => expect(savedList()[1]).not.toHaveProperty('shared'))
  })

  it('exports one from its menu', async () => {
    await openPage()
    fireEvent.click(within(lanes()[2]).getByRole('button', { name: 'More for Thesis' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }))
    await waitFor(() => expect(store.exported).toEqual(['thesis']))
    expect(await screen.findByText('Exported to thesis-workspace.json')).toBeTruthy()
  })

  it('imports a Checkpoint file under the name given, then switches to it', async () => {
    store.importFile = { success: true, payload: { context: 'recipes', items: [{}, {}], tags: [], relations: [] } }
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('2 items, 0 tags and 0 links.')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(store.imported.map(([slug]) => slug)).toEqual(['recipes']))
    await waitFor(() => expect(useAppStore.getState().activeWorkspace).toBe('recipes'))
  })

  it('warns before a Checkpoint file goes into a workspace that exists', async () => {
    store.importFile = { success: true, payload: { context: 'thesis', items: [], tags: [], relations: [] } }
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText(/#thesis already exists/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Import into it' })).toBeTruthy()
  })
})
