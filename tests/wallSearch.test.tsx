// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallSearch from '../src/renderer/src/components/wall/WallSearch'
import { createWallItem, type WallItem } from '../src/shared/wallModel'
import type { SearchKind } from '../src/shared/wallFind'

afterEach(cleanup)

const note = (text: string): WallItem => ({ ...createWallItem('note', { x: 0, y: 0 }, []), text })
const labelOf = (item: WallItem): string | undefined => item.text || undefined

const renderSearch = (over: { query?: string; kind?: SearchKind; matches?: WallItem[] } = {}) => {
  const handlers = { setQuery: vi.fn(), setKind: vi.fn(), jumpTo: vi.fn() }
  render(
    <WallSearch
      query={over.query ?? ''}
      kind={over.kind ?? 'all'}
      matches={over.matches ?? []}
      labelOf={labelOf}
      {...handlers}
    />
  )
  return handlers
}

const box = () => screen.getByLabelText('Find on this wall')

describe('WallSearch', () => {
  it('says so when nothing on the wall matches', () => {
    renderSearch({ query: 'roadmap' })
    expect(screen.getByText('Nothing on this wall matches.')).toBeTruthy()
  })

  it('jumps to the best match on Enter and ends the search', () => {
    const best = note('Roadmap')
    const { setQuery, setKind, jumpTo } = renderSearch({ query: 'road', kind: 'note', matches: [best, note('Road trip')] })

    fireEvent.keyDown(box(), { key: 'Enter' })

    expect(jumpTo).toHaveBeenCalledWith(best)
    expect(setQuery).toHaveBeenCalledWith('')
    expect(setKind).toHaveBeenCalledWith('all')
  })

  it('clears the words and the kind on Escape without jumping anywhere', () => {
    const { setQuery, setKind, jumpTo } = renderSearch({ query: 'road', kind: 'image', matches: [note('Roadmap')] })

    fireEvent.keyDown(box(), { key: 'Escape' })

    expect(setQuery).toHaveBeenCalledWith('')
    expect(setKind).toHaveBeenCalledWith('all')
    expect(jumpTo).not.toHaveBeenCalled()
  })

  it('jumps to a clicked result and keeps the search, naming one that has no label', () => {
    const untitled = note('')
    const { setQuery, jumpTo } = renderSearch({ query: 'x', matches: [untitled] })

    fireEvent.click(screen.getByText('(untitled)'))

    expect(jumpTo).toHaveBeenCalledWith(untitled)
    expect(setQuery).not.toHaveBeenCalled()
  })

  it('narrows to one kind from the chips once the box has focus', () => {
    const { setKind } = renderSearch()
    expect(screen.queryByText('Images')).toBeNull()

    fireEvent.focus(box())
    fireEvent.click(screen.getByText('Images'))

    expect(setKind).toHaveBeenCalledWith('image')
  })

  it('clears a search from its button', () => {
    const { setQuery, setKind } = renderSearch({ kind: 'frame' })

    fireEvent.click(screen.getByLabelText('Clear the search'))

    expect(setQuery).toHaveBeenCalledWith('')
    expect(setKind).toHaveBeenCalledWith('all')
  })
})
