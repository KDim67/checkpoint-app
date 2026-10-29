// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import KanbanCard from '../src/renderer/src/components/kanban/KanbanCard'
import { CardWindowContext, createCardWindow, EAGER_CARDS } from '../src/renderer/src/components/kanban/cardWindow'
import type { Item } from '../src/shared/types'

// a long column draws the cards near its view and holds the room of the rest until they come near

vi.mock('../src/renderer/src/lib/useViewShortcuts', () => ({
  useViewShortcuts: vi.fn(() => ({ bindings: {}, match: () => null }))
}))

/** stands in for the browser's: the test says which cards came near */
class FakeObserver {
  static all: FakeObserver[] = []
  watched = new Set<Element>()
  constructor(public onEntries: IntersectionObserverCallback, public options?: IntersectionObserverInit) { FakeObserver.all.push(this) }
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
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const card = (i: number): Item => ({
  id: `c${i}`, type: 'card', context: 'dev', title: `Card ${i}`, body: '', status: 'done', priority: 0,
  position: i, created_at: 0, updated_at: 0, due_at: null, metadata: '{}'
} as Item)
const noop = (): void => {}
const CARDS = Array.from({ length: 30 }, (_, i) => card(i))

function Column() {
  const [cardWindow] = useState(createCardWindow)
  return (
    <DndContext>
      <div ref={cardWindow.setRoot} data-testid="scroller">
        <CardWindowContext.Provider value={cardWindow}>
          <SortableContext items={CARDS.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {CARDS.map((c, i) => <KanbanCard key={c.id} card={c} onClick={noop} onDelete={noop} onConvertToTask={noop} eager={i < EAGER_CARDS} />)}
          </SortableContext>
        </CardWindowContext.Provider>
      </div>
    </DndContext>
  )
}

const drawn = (): number => document.querySelectorAll('.kanban-card').length
const pending = (title: string): HTMLElement => screen.getByRole('button', { name: title })

describe('a long column', () => {
  it('draws its first cards at once and holds the room of the rest', () => {
    render(<Column />)
    expect(drawn()).toBe(EAGER_CARDS)
    const held = pending('Card 25')
    expect(held.classList.contains('kanban-card-pending')).toBe(true)
    expect(held.style.height).not.toBe('')
    // watched from the column's own scroller, a screen's worth ahead
    expect(FakeObserver.all).toHaveLength(1)
    expect(FakeObserver.all[0].options?.root).toBe(screen.getByTestId('scroller'))
    expect(FakeObserver.all[0].watched.size).toBe(CARDS.length - EAGER_CARDS)
  })

  it('draws a card once it comes near, and stops watching it', () => {
    render(<Column />)
    const observer = FakeObserver.all[0]
    const wrapper = pending('Card 25').parentElement as HTMLElement
    act(() => observer.bringNear(wrapper))
    expect(screen.getByText('Card 25').closest('.kanban-card')).toBeTruthy()
    expect(observer.watched.has(wrapper)).toBe(false)
    expect(drawn()).toBe(EAGER_CARDS + 1)
  })

  it('draws a held card that Tab reaches, and hands it the focus', () => {
    render(<Column />)
    act(() => { pending('Card 27').focus() })
    const face = screen.getByText('Card 27').closest<HTMLElement>('.kanban-card')
    expect(face).toBeTruthy()
    expect(document.activeElement).toBe(face)
  })

  it('draws every card where nothing can say when one comes near', () => {
    vi.unstubAllGlobals()
    const saved = globalThis.IntersectionObserver
    // jsdom has none of its own
    expect(saved).toBeUndefined()
    render(<Column />)
    expect(drawn()).toBe(CARDS.length)
  })

  it('draws every card outside a column, as the drag overlay and the details preview are', () => {
    render(
      <DndContext>
        <SortableContext items={['c29']}>
          <KanbanCard card={CARDS[29]} onClick={noop} onDelete={noop} onConvertToTask={noop} />
        </SortableContext>
      </DndContext>
    )
    expect(drawn()).toBe(1)
  })
})

describe('the column watcher', () => {
  it('watches cards that asked before its scroller existed, once it does', () => {
    const cardWindow = createCardWindow()
    const el = document.createElement('div')
    const onNear = vi.fn()
    cardWindow.watch(el, onNear)
    cardWindow.setRoot(document.createElement('div'))
    const observer = FakeObserver.all[0]
    expect(observer.watched.has(el)).toBe(true)
    observer.bringNear(el)
    observer.bringNear(el)
    expect(onNear).toHaveBeenCalledTimes(1)
  })

  it('lets go of everything when the column goes', () => {
    const cardWindow = createCardWindow()
    cardWindow.setRoot(document.createElement('div'))
    const el = document.createElement('div')
    cardWindow.watch(el, vi.fn())
    cardWindow.setRoot(null)
    expect(FakeObserver.all[0].watched.size).toBe(0)
  })
})
