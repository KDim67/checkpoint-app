// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type CollisionDetection } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import KanbanCard from '../src/renderer/src/components/kanban/KanbanCard'
import { useViewShortcuts } from '../src/renderer/src/lib/useViewShortcuts'
import type { Item } from '../src/shared/types'

// one call per card face drawn, so it doubles as the render counter
vi.mock('../src/renderer/src/lib/useViewShortcuts', () => ({
  useViewShortcuts: vi.fn(() => ({ bindings: {}, match: () => null }))
}))

beforeEach(() => vi.mocked(useViewShortcuts).mockClear())
afterEach(cleanup)

const card = (id: string, status: string): Item => ({
  id, type: 'card', context: 'dev', title: `Card ${id}`, body: 'Some **markdown** body', status, priority: 0,
  position: 0, created_at: 0, updated_at: 0, due_at: null, metadata: '{}'
} as Item)

const columns = { todo: ['a1', 'a2', 'a3'].map(id => card(id, 'todo')), doing: ['b1', 'b2', 'b3'].map(id => card(id, 'doing')) }
const order = [...columns.todo, ...columns.doing].map(c => c.id)

/** jsdom has no layout, so the pointer's y picks the card, 100px a card */
const byPointer: CollisionDetection = ({ pointerCoordinates, droppableContainers }) => {
  const id = pointerCoordinates ? order[Math.floor(pointerCoordinates.y / 100)] : undefined
  return id && droppableContainers.some(c => c.id === id) ? [{ id }] : []
}

// stable like the board's handlers, a fresh one per render would redraw every card by itself
const noop = (): void => {}

function Board({ onStart }: { onStart: (id: string) => void }) {
  const [lifted, setLifted] = useState<Item | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={byPointer}
      onDragStart={e => {
        onStart(String(e.active.id))
        setLifted([...columns.todo, ...columns.doing].find(c => c.id === e.active.id) ?? null)
      }}
      onDragEnd={() => setLifted(null)}
      onDragCancel={() => setLifted(null)}
    >
      {Object.entries(columns).map(([status, cards]) => (
        <SortableContext key={status} items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map(c => <KanbanCard key={c.id} card={c} onClick={noop} onDelete={noop} onConvertToTask={noop} />)}
        </SortableContext>
      ))}
      <DragOverlay dropAnimation={null}>
        {lifted ? <KanbanCard card={lifted} onClick={noop} onDelete={noop} onConvertToTask={noop} isOverlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}

const cardEl = (id: string): HTMLElement => {
  const el = screen.getByText(`Card ${id}`).closest<HTMLElement>('.kanban-card')
  if (!el) throw new Error(`no card ${id}`)
  return el
}

const pointer = { isPrimary: true, button: 0, clientX: 10 }
const lift = (id: string): void => {
  const y = order.indexOf(id) * 100 + 10
  fireEvent.pointerDown(cardEl(id), { ...pointer, clientY: y })
  fireEvent.pointerMove(document, { ...pointer, clientY: y + 20 })
}
const moveTo = (id: string): void => {
  fireEvent.pointerMove(document, { ...pointer, clientY: order.indexOf(id) * 100 + 50 })
}
// the overlay lingers a microtask after drop, even with no drop animation
const drop = async (): Promise<void> => {
  await act(async () => { fireEvent.pointerUp(document, pointer) })
}

describe('KanbanCard dragging', () => {
  it('can pick up the same card again after dropping it', async () => {
    const onStart = vi.fn()
    render(<Board onStart={onStart} />)

    lift('a1')
    moveTo('a2')
    await drop()
    lift('a1')
    await drop()

    expect(onStart.mock.calls.map(([id]) => id)).toEqual(['a1', 'a1'])
  })

  it('redraws only the lifted card while carrying it across the board', async () => {
    render(<Board onStart={vi.fn()} />)
    vi.mocked(useViewShortcuts).mockClear()

    lift('a1')
    // the lifted card turns into its placeholder and the overlay copy draws for the first time
    expect(vi.mocked(useViewShortcuts)).toHaveBeenCalledTimes(2)
    vi.mocked(useViewShortcuts).mockClear()

    moveTo('a3')
    moveTo('b1')
    moveTo('b2')

    expect(vi.mocked(useViewShortcuts)).not.toHaveBeenCalled()
    await drop()
  })
})
