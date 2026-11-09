// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import KanbanColumn from '../src/renderer/src/components/kanban/KanbanColumn'
import KanbanCard from '../src/renderer/src/components/kanban/KanbanCard'
import BacklogTable from '../src/renderer/src/components/backlog/BacklogTable'
import { ConfirmProvider } from '../src/renderer/src/components/ui/ConfirmDialog'
import { useAppStore } from '../src/renderer/src/store/appStore'
import type { Item } from '../src/shared/types'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

afterEach(cleanup)

describe('KanbanColumn collapse interactions', () => {
  const defaultProps = {
    id: 'col-todo',
    name: 'To Do',
    wipLimit: null,
    cards: [],
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onCardClick: vi.fn(),
    onCardDelete: vi.fn(),
    onCardConvertToTask: vi.fn(),
    onToggleCollapse: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  it('renders a collapse button in the header hover actions and calls onToggleCollapse when clicked', () => {
    render(
      <ConfirmProvider>
        <DndContext>
          <KanbanColumn {...defaultProps} />
        </DndContext>
      </ConfirmProvider>
    )

    const collapseBtn = screen.getByLabelText('Collapse To Do column')
    expect(collapseBtn).toBeTruthy()
    fireEvent.click(collapseBtn)
    expect(defaultProps.onToggleCollapse).toHaveBeenCalledWith('col-todo')
  })

  it('renders collapsed column strip and expands when clicking anywhere on the strip', () => {
    render(
      <ConfirmProvider>
        <DndContext>
          <KanbanColumn {...defaultProps} collapsed={true} />
        </DndContext>
      </ConfirmProvider>
    )

    const expandStrip = screen.getByRole('button', { name: 'Expand To Do column' })
    expect(expandStrip).toBeTruthy()
    fireEvent.click(expandStrip)
    expect(defaultProps.onToggleCollapse).toHaveBeenCalledWith('col-todo')
  })

  it('expands collapsed column on Enter or Space keydown', () => {
    render(
      <ConfirmProvider>
        <DndContext>
          <KanbanColumn {...defaultProps} collapsed={true} />
        </DndContext>
      </ConfirmProvider>
    )

    const expandStrip = screen.getByRole('button', { name: 'Expand To Do column' })
    fireEvent.keyDown(expandStrip, { key: 'Enter' })
    expect(defaultProps.onToggleCollapse).toHaveBeenCalledWith('col-todo')

    fireEvent.keyDown(expandStrip, { key: ' ' })
    expect(defaultProps.onToggleCollapse).toHaveBeenCalledTimes(2)
  })
})

describe('KanbanCard priority hotkeys', () => {
  const makeCard = (priority: 0 | 1 | 2 | 3 = 0): Item => ({
    id: 'card-1',
    type: 'card',
    context: 'test',
    title: 'Test Card',
    body: '',
    status: 'col-todo',
    priority,
    position: 0,
    created_at: 0,
    updated_at: 0,
    due_at: null,
    metadata: '{}'
  })

  it('updates priority on hover when pressing 0, 1, 2, 3', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const card = makeCard(0)

    render(
      <DndContext>
        <SortableContext items={[card.id]} strategy={verticalListSortingStrategy}>
          <KanbanCard
            card={card}
            onClick={vi.fn()}
            onDelete={vi.fn()}
            onConvertToTask={vi.fn()}
            onUpdate={onUpdate}
          />
        </SortableContext>
      </DndContext>
    )

    const cardEl = screen.getByRole('button', { name: /Test Card/i })

    // Hover over the card
    fireEvent.mouseEnter(cardEl)

    // Press '3' to set High priority
    fireEvent.keyDown(window, { key: '3' })
    expect(onUpdate).toHaveBeenCalledWith('card-1', { priority: 3 })

    // Press '1' to set Low priority
    fireEvent.keyDown(window, { key: '1' })
    expect(onUpdate).toHaveBeenCalledWith('card-1', { priority: 1 })

    // Press '0' to set None priority
    fireEvent.keyDown(window, { key: '0' })
    expect(onUpdate).toHaveBeenCalledWith('card-1', { priority: 0 })
  })

  it('does not trigger priority change when typing inside an input', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const card = makeCard(0)

    render(
      <DndContext>
        <SortableContext items={[card.id]} strategy={verticalListSortingStrategy}>
          <KanbanCard
            card={card}
            onClick={vi.fn()}
            onDelete={vi.fn()}
            onConvertToTask={vi.fn()}
            onUpdate={onUpdate}
          />
        </SortableContext>
        <input data-testid="search-input" />
      </DndContext>
    )

    const cardEl = screen.getByRole('button', { name: /Test Card/i })
    fireEvent.mouseEnter(cardEl)

    const input = screen.getByTestId('search-input')
    input.focus()

    fireEvent.keyDown(window, { key: '2' })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('BacklogTable group collapse persistence', () => {
  const dummyItem: Item = {
    id: 'b-1',
    type: 'card',
    context: 'test',
    title: 'Backlog Task 1',
    body: '',
    status: 'col-todo',
    priority: 1,
    position: 0,
    created_at: 0,
    updated_at: 0,
    due_at: null,
    metadata: '{}'
  }

  it('persists collapsed state to localStorage and restores it', () => {
    const ws = 'test-workspace'
    useAppStore.setState({ activeWorkspace: ws })
    localStorage.removeItem(`checkpoint_backlog_collapsed_${ws}`)

    const { container, unmount } = render(
      <BacklogTable
        items={[dummyItem]}
        columns={[{ id: 'col-todo', name: 'To Do' }]}
        allTags={[]}
        selectedIds={[]}
        setSelectedIds={vi.fn()}
        visibleColumns={{ title: true, status: true }}
        columnWidths={{ title: 200, status: 120 }}
        columnOrder={['title', 'status']}
        grouping="status"
        sortBy="position"
        sortDesc={false}
        onSortChange={vi.fn()}
        onColumnWidthChange={vi.fn()}
        onColumnOrderChange={vi.fn()}
        onColumnVisibilityToggle={vi.fn()}
        onRowDoubleClick={vi.fn()}
        onUpdateField={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const header = container.querySelector('.backlog-group-header') as HTMLElement
    expect(header).toBeTruthy()
    fireEvent.click(header)

    const stored = localStorage.getItem(`checkpoint_backlog_collapsed_${ws}`)
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored || '{}')
    expect(parsed['col-todo']).toBe(true)

    unmount()

    // Re-rendering restores collapsed state from localStorage
    render(
      <BacklogTable
        items={[dummyItem]}
        columns={[{ id: 'col-todo', name: 'To Do' }]}
        allTags={[]}
        selectedIds={[]}
        setSelectedIds={vi.fn()}
        visibleColumns={{ title: true, status: true }}
        columnWidths={{ title: 200, status: 120 }}
        columnOrder={['title', 'status']}
        grouping="status"
        sortBy="position"
        sortDesc={false}
        onSortChange={vi.fn()}
        onColumnWidthChange={vi.fn()}
        onColumnOrderChange={vi.fn()}
        onColumnVisibilityToggle={vi.fn()}
        onRowDoubleClick={vi.fn()}
        onUpdateField={vi.fn().mockResolvedValue(undefined)}
      />
    )

    // The item row should be collapsed / not visible in the flat rows
    expect(screen.queryByText('Backlog Task 1')).toBeNull()
  })
})
