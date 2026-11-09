// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import KanbanFilterBar from '../src/renderer/src/components/kanban/KanbanFilterBar'
import type { KanbanBoard } from '../src/renderer/src/components/kanban/useKanbanBoard'
import type { Tag } from '../src/shared/types'

afterEach(cleanup)

const tags: Tag[] = [
  { id: 'tag-bug', name: 'bug', color: '#e5484d' },
  { id: 'tag-ux', name: 'ux', color: '#535e85' }
]

/** filters are board state, the harness shows the result */
function Board() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterPriority, setFilterPriority] = useState(-1)
  const [filterTagId, setFilterTagId] = useState('all')
  const filters = { searchQuery, setSearchQuery, filterPriority, setFilterPriority, filterTagId, setFilterTagId, allTags: tags }
  return (
    <>
      <KanbanFilterBar kanbanBoard={filters as KanbanBoard} />
      <output aria-label="Filters">{JSON.stringify({ searchQuery, filterPriority, filterTagId })}</output>
    </>
  )
}

const filters = () => JSON.parse(screen.getByLabelText('Filters').textContent ?? 'null')
const selects = () => {
  const [priority, tag] = screen.getAllByRole('combobox')
  return { priority, tag }
}

describe('KanbanFilterBar', () => {
  it('offers Reset only while something is filtered', () => {
    render(<Board />)
    expect(screen.queryByText('Reset')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Search cards (title, body, tag)...'), { target: { value: 'login' } })

    expect(filters().searchQuery).toBe('login')
    expect(screen.getByText('Reset')).toBeTruthy()
  })

  it('filters by priority as a number, not the text of the option', () => {
    render(<Board />)

    fireEvent.change(selects().priority, { target: { value: '3' } })

    expect(filters().filterPriority).toBe(3)
  })

  it('lists the board tags and filters by the chosen one', () => {
    render(<Board />)
    expect(screen.getByRole('option', { name: 'bug' })).toBeTruthy()

    fireEvent.change(selects().tag, { target: { value: 'tag-ux' } })

    expect(filters().filterTagId).toBe('tag-ux')
  })

  it('clears all three at once', () => {
    render(<Board />)
    fireEvent.change(screen.getByPlaceholderText('Search cards (title, body, tag)...'), { target: { value: 'login' } })
    fireEvent.change(selects().priority, { target: { value: '1' } })
    fireEvent.change(selects().tag, { target: { value: 'tag-bug' } })

    fireEvent.click(screen.getByText('Reset'))

    expect(filters()).toEqual({ searchQuery: '', filterPriority: -1, filterTagId: 'all' })
    expect(screen.queryByText('Reset')).toBeNull()
  })

  it('clears search input with inline clear button', () => {
    render(<Board />)
    const input = screen.getByPlaceholderText('Search cards (title, body, tag)...')
    fireEvent.change(input, { target: { value: 'fix error' } })
    expect(filters().searchQuery).toBe('fix error')

    const clearBtn = screen.getByLabelText('Clear search')
    expect(clearBtn).toBeTruthy()
    fireEvent.click(clearBtn)
    expect(filters().searchQuery).toBe('')
  })

  it('displays the hidden count badge when cards are filtered out', () => {
    const mockBoard = {
      searchQuery: 'task 1',
      setSearchQuery: () => {},
      filterPriority: -1,
      setFilterPriority: () => {},
      filterTagId: 'all',
      setFilterTagId: () => {},
      allTags: tags,
      cards: [
        { id: '1', title: 'task 1', status: 'active' },
        { id: '2', title: 'task 2', status: 'active' },
        { id: '3', title: 'task 3', status: 'active' }
      ],
      columns: [{ id: 'col-1', name: 'Todo' }],
      getCardsForColumn: (_colId: string) => [{ id: '1', title: 'task 1', status: 'active' }]
    }
    render(<KanbanFilterBar kanbanBoard={mockBoard as unknown as KanbanBoard} />)
    expect(screen.getByText('2 hidden')).toBeTruthy()
  })
})
