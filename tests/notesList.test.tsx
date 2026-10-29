// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import NotesSidebar from '../src/renderer/src/components/notes/NotesSidebar'
import { EAGER_NOTES } from '../src/renderer/src/components/notes/NoteRow'
import { formatRelativeTime } from '../src/renderer/src/components/notes/notesUtils'
import { useStableCallback } from '../src/renderer/src/lib/useStableCallback'
import type { NoteMetadata } from '../src/shared/types'

// a vault of thousands: the notes list draws what's near its view, and typing in a note leaves the list alone

// one call per drawn row, so it doubles as the render counter
vi.mock('../src/renderer/src/components/notes/notesUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/renderer/src/components/notes/notesUtils')>()),
  formatRelativeTime: vi.fn(() => 'just now')
}))

/** stands in for the browser's: the test says which rows came near */
class FakeObserver {
  static all: FakeObserver[] = []
  watched = new Set<Element>()
  constructor(public onEntries: IntersectionObserverCallback) { FakeObserver.all.push(this) }
  observe(el: Element): void { this.watched.add(el) }
  unobserve(el: Element): void { this.watched.delete(el) }
  disconnect(): void { this.watched.clear() }
  takeRecords(): IntersectionObserverEntry[] { return [] }
  bringNear(el: Element): void {
    this.onEntries([{ target: el, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

beforeEach(() => {
  FakeObserver.all = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  vi.mocked(formatRelativeTime).mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const note = (i: number): NoteMetadata => ({ title: `Note ${i}`, tags: ['#plan'], links: [], updatedAt: 1_700_000_000_000 - i, size: 100, excerpt: `About note ${i}` })
const ITEMS = Array.from({ length: 100 }, (_, i) => ({ note: note(i) }))
const noop = (): void => {}

const props = (onSelect: (title: string) => void = noop) => ({
  items: ITEMS, allTags: ['#plan'], totalCount: ITEMS.length, activeTitle: null, pinned: new Set<string>(), loading: false,
  searching: false, searchQuery: '', onSearchChange: noop, sort: 'updated' as const, onSortChange: noop,
  selectedTag: null, onSelectTag: noop, onSelect, onTogglePin: noop, onCreate: noop, onDaily: noop, onImportVault: noop
})

const held = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.notes-list-item-held'))

describe('a long notes list', () => {
  it('draws its first notes in full and holds the rest as their titles in the room they take', () => {
    render(<NotesSidebar {...props()} />)
    expect(screen.getAllByRole('button', { name: 'Pin note' })).toHaveLength(EAGER_NOTES)
    expect(held()).toHaveLength(ITEMS.length - EAGER_NOTES)
    const last = held().at(-1) as HTMLElement
    expect(last.textContent).toBe('Note 99')
    expect(last.style.height).not.toBe('')
  })

  it('draws a held note once it comes near', () => {
    render(<NotesSidebar {...props()} />)
    const row = screen.getByText('Note 60').closest('.notes-list-item') as HTMLElement
    act(() => FakeObserver.all[0].bringNear(row))
    expect(screen.getByText('About note 60')).toBeTruthy()
    expect(held()).toHaveLength(ITEMS.length - EAGER_NOTES - 1)
  })

  it('opens a held note that is clicked before it has been drawn', () => {
    const onSelect = vi.fn()
    render(<NotesSidebar {...props(onSelect)} />)
    fireEvent.click(screen.getByText('Note 80'))
    expect(onSelect).toHaveBeenCalledWith('Note 80')
  })

  it('is not drawn again when the screen around it redraws with nothing new for it, as on every key typed in a note', () => {
    const same = props()
    const { rerender } = render(<NotesSidebar {...same} />)
    const drawnOnce = vi.mocked(formatRelativeTime).mock.calls.length
    expect(drawnOnce).toBe(EAGER_NOTES)
    rerender(<NotesSidebar {...same} />)
    rerender(<NotesSidebar {...same} />)
    expect(vi.mocked(formatRelativeTime).mock.calls.length).toBe(drawnOnce)
  })

  it('draws every note where nothing can say when one comes near', () => {
    vi.unstubAllGlobals()
    render(<NotesSidebar {...props()} />)
    expect(held()).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'Pin note' })).toHaveLength(ITEMS.length)
  })
})

describe('a stable callback', () => {
  it('keeps its identity across renders but runs the latest version', () => {
    const seen: string[] = []
    const { result, rerender } = renderHook(({ word }) => useStableCallback(() => seen.push(word)), { initialProps: { word: 'first' } })
    const first = result.current
    rerender({ word: 'second' })
    expect(result.current).toBe(first)
    result.current()
    expect(seen).toEqual(['second'])
  })
})
