// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import KanbanCard from '../src/renderer/src/components/kanban/KanbanCard'
import { filterBoardCards } from '../src/renderer/src/components/kanban/useBoardDrag'
import { DAY_MS } from '../src/shared/dueDate'
import type { Item } from '../src/shared/types'

afterEach(cleanup)

const makeCard = (over: Partial<Item> = {}): Item => ({
  id: 'card-1',
  type: 'card',
  context: 'work',
  title: 'Card title',
  body: '',
  status: 'open',
  priority: 0,
  position: 1000,
  created_at: 0,
  updated_at: 0,
  due_at: null,
  metadata: '{}',
  ...over
})

describe('filterBoardCards due date filter', () => {
  const now = new Date(2026, 10, 26, 12, 0, 0).getTime()

  const cards: Item[] = [
    makeCard({ id: 'past', title: 'Overdue card', due_at: now - 2 * DAY_MS }),
    makeCard({ id: 'soon', title: 'Due tomorrow', due_at: now + DAY_MS }),
    makeCard({ id: 'later', title: 'Due next week', due_at: now + 7 * DAY_MS }),
    makeCard({ id: 'done-col', title: 'Finished card', status: 'done', due_at: now - DAY_MS }),
    makeCard({ id: 'due-done', title: 'Marked due done', due_at: now - DAY_MS, metadata: JSON.stringify({ dueDateCompleted: true }) }),
    makeCard({ id: 'none', title: 'No due date', due_at: null })
  ]

  it('filters to overdue active cards only', () => {
    const out = filterBoardCards(cards, { searchQuery: '', filterPriority: -1, filterTagId: 'all', filterDue: 'overdue' }, now)
    expect(out.map(c => c.id)).toEqual(['past'])
  })

  it('filters to cards due within 3 days and not overdue', () => {
    const out = filterBoardCards(cards, { searchQuery: '', filterPriority: -1, filterTagId: 'all', filterDue: 'soon' }, now)
    expect(out.map(c => c.id)).toEqual(['soon'])
  })
})

describe('KanbanCard blocked indicator and selection', () => {
  const renderCard = (card: Item, props: { selected?: boolean; selectionActive?: boolean; onClick?: (id: string) => void; onToggleSelect?: (id: string) => void } = {}) =>
    render(
      <DndContext>
        <SortableContext items={[card.id]} strategy={verticalListSortingStrategy}>
          <KanbanCard
            card={card}
            onClick={props.onClick ?? vi.fn()}
            onDelete={vi.fn()}
            onConvertToTask={vi.fn()}
            selected={props.selected}
            selectionActive={props.selectionActive}
            onToggleSelect={props.onToggleSelect}
          />
        </SortableContext>
      </DndContext>
    )

  it('shows Blocked badge for blocked active cards and hides it when done', () => {
    const { rerender } = renderCard(makeCard({ id: 'b1', blockedByCount: 1 }))
    expect(screen.getByText('Blocked')).toBeTruthy()

    rerender(
      <DndContext>
        <SortableContext items={['b1']} strategy={verticalListSortingStrategy}>
          <KanbanCard
            card={makeCard({ id: 'b1', blockedByCount: 2 })}
            onClick={vi.fn()}
            onDelete={vi.fn()}
            onConvertToTask={vi.fn()}
          />
        </SortableContext>
      </DndContext>
    )
    expect(screen.getByText('Blocked (2)')).toBeTruthy()

    rerender(
      <DndContext>
        <SortableContext items={['b1']} strategy={verticalListSortingStrategy}>
          <KanbanCard
            card={makeCard({ id: 'b1', status: 'done', blockedByCount: 2 })}
            onClick={vi.fn()}
            onDelete={vi.fn()}
            onConvertToTask={vi.fn()}
          />
        </SortableContext>
      </DndContext>
    )
    expect(screen.queryByText(/Blocked/)).toBeNull()
  })

  it('toggles multi-selection via Ctrl+Click, selection checkbox, or active selection click', () => {
    const onClick = vi.fn()
    const onToggleSelect = vi.fn()
    const card = makeCard({ id: 's1', title: 'Selectable card' })

    const { rerender } = renderCard(card, { onClick, onToggleSelect })
    const cardEl = screen.getByRole('button', { name: /Selectable card/i })

    fireEvent.click(cardEl)
    expect(onClick).toHaveBeenCalledWith('s1')
    expect(onToggleSelect).not.toHaveBeenCalled()

    fireEvent.click(cardEl, { ctrlKey: true })
    expect(onToggleSelect).toHaveBeenCalledWith('s1')
    expect(onClick).toHaveBeenCalledTimes(1)

    fireEvent.mouseEnter(cardEl)
    fireEvent.click(screen.getByRole('button', { name: 'Select card' }))
    expect(onToggleSelect).toHaveBeenCalledTimes(2)

    rerender(
      <DndContext>
        <SortableContext items={['s1']} strategy={verticalListSortingStrategy}>
          <KanbanCard
            card={card}
            onClick={onClick}
            onDelete={vi.fn()}
            onConvertToTask={vi.fn()}
            selected={false}
            selectionActive={true}
            onToggleSelect={onToggleSelect}
          />
        </SortableContext>
      </DndContext>
    )
    fireEvent.click(screen.getByRole('button', { name: /Selectable card/i }))
    expect(onToggleSelect).toHaveBeenCalledTimes(3)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
