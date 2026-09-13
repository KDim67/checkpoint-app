// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ArchiveBin from '../src/renderer/src/components/kanban/ArchiveBin'
import type { Item } from '../src/shared/types'
import type { ColumnConfig } from '../src/shared/boardModel'

afterEach(cleanup)

type Props = Parameters<typeof ArchiveBin>[0]

const card = (id: string, title: string, status = 'archived'): Item => ({
  id, type: 'card', context: 'dev', title, body: '', status, priority: 0,
  position: 0, created_at: 0, updated_at: 0, due_at: null, metadata: '{}'
} as Item)

const cards = [card('a', 'Fix login'), card('b', 'Ship release notes'), card('c', 'Still on the board', 'todo')]
const parked = { id: 'col-parked', name: 'Parked' } as ColumnConfig

/** The selection lives on the board, so the harness owns it the way the board does. */
function Board(props: Omit<Props, 'selectedIds' | 'setSelected'> & { initial?: string[] }) {
  const [selectedIds, setSelected] = useState(new Set(props.initial ?? []))
  return <ArchiveBin {...props} selectedIds={selectedIds} setSelected={setSelected} />
}

const renderBin = (overrides: Partial<Props> & { initial?: string[] } = {}) => {
  const handlers = {
    onClose: vi.fn<Props['onClose']>(),
    onRestoreColumn: vi.fn<Props['onRestoreColumn']>(),
    onDeleteColumn: vi.fn<Props['onDeleteColumn']>(),
    onRestoreCard: vi.fn<Props['onRestoreCard']>(),
    onDeleteCard: vi.fn<Props['onDeleteCard']>(),
    onBulkRestore: vi.fn<Props['onBulkRestore']>(),
    onBulkDelete: vi.fn<Props['onBulkDelete']>()
  }
  render(<Board archivedColumns={[parked]} cards={cards} {...handlers} {...overrides} />)
  return handlers
}

const parentOf = (el: HTMLElement): HTMLElement => {
  if (!el.parentElement) throw new Error(`nothing contains ${el.textContent}`)
  return el.parentElement
}

/** The row a card title sits in, which is also what toggles its selection. */
const cardRow = (title: string) => parentOf(parentOf(screen.getByTitle(title)))

describe('ArchiveBin', () => {
  it('lists the archived columns and only the archived cards', () => {
    renderBin()

    expect(screen.getByText('Archived Columns (1)')).toBeTruthy()
    expect(screen.getByText('Archived Cards (2)')).toBeTruthy()
    expect(screen.queryByText('Still on the board')).toBeNull()
  })

  it('says so when there is nothing archived', () => {
    renderBin({ archivedColumns: [], cards: [card('c', 'Still on the board', 'todo')] })

    expect(screen.getByText('No archived columns.')).toBeTruthy()
    expect(screen.getByText('No archived cards.')).toBeTruthy()
    expect(screen.queryByText('Select all')).toBeNull()
  })

  it('restores or deletes a column by its id', () => {
    const { onRestoreColumn, onDeleteColumn } = renderBin()
    const row = parentOf(screen.getByText('Parked'))

    fireEvent.click(within(row).getByText('Restore'))
    fireEvent.click(within(row).getByText('Delete'))

    expect(onRestoreColumn).toHaveBeenCalledWith('col-parked')
    expect(onDeleteColumn).toHaveBeenCalledWith('col-parked')
  })

  it('selects a card by clicking its row, and counts the selection', () => {
    renderBin()

    fireEvent.click(cardRow('Fix login'))

    expect(screen.getByText('1 selected')).toBeTruthy()
    expect(screen.getByText('Delete (1)')).toBeTruthy()

    fireEvent.click(cardRow('Fix login'))

    expect(screen.queryByText('1 selected')).toBeNull()
  })

  it('restores or deletes one card without touching the selection', () => {
    const { onRestoreCard, onDeleteCard } = renderBin()
    const row = cardRow('Ship release notes')

    fireEvent.click(within(row).getByText('Restore'))
    fireEvent.click(within(row).getByText('Delete'))

    expect(onRestoreCard).toHaveBeenCalledWith('b')
    expect(onDeleteCard).toHaveBeenCalledWith(cards[1])
    expect(screen.queryByText(/selected$/)).toBeNull()
  })

  it('selects every archived card at once, then clears them', () => {
    const { onBulkRestore, onBulkDelete } = renderBin()

    fireEvent.click(screen.getByText('Select all'))
    expect(screen.getByText('2 selected')).toBeTruthy()

    fireEvent.click(screen.getByText('Delete (2)'))
    expect(onBulkDelete).toHaveBeenCalledTimes(1)

    fireEvent.click(within(parentOf(screen.getByText('2 selected'))).getByText('Restore'))
    expect(onBulkRestore).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Clear'))
    expect(screen.queryByText('2 selected')).toBeNull()
  })

  it('ignores a stale selection of cards that are no longer archived', () => {
    renderBin({ initial: ['c', 'gone'] })

    expect(screen.queryByText(/selected$/)).toBeNull()
    expect(screen.getByText('Select all')).toBeTruthy()
  })

  it('closes from the backdrop but not from inside the drawer', () => {
    const { onClose } = renderBin()

    fireEvent.click(screen.getByText('Archive Bin'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog', { name: 'Archive bin' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
