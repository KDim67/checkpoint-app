// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallSearch from '../src/renderer/src/components/wall/WallSearch'
import { createWallItem, type WallItem } from '../src/shared/wallModel'

afterEach(cleanup)

const note = (text: string): WallItem => ({ ...createWallItem('note', { x: 0, y: 0 }, []), text })
const labelOf = (item: WallItem): string | undefined => item.text || undefined

describe('WallSearch', () => {
  it('says so when nothing on the wall matches', () => {
    render(<WallSearch query="roadmap" setQuery={vi.fn()} matches={[]} jumpTo={vi.fn()} labelOf={labelOf} />)
    expect(screen.getByText('Nothing on this wall matches.')).toBeTruthy()
  })

  it('jumps to the best match on Enter and clears the search', () => {
    const setQuery = vi.fn()
    const jumpTo = vi.fn()
    const best = note('Roadmap')
    render(<WallSearch query="road" setQuery={setQuery} matches={[best, note('Road trip')]} jumpTo={jumpTo} labelOf={labelOf} />)

    fireEvent.keyDown(screen.getByLabelText('Find on this wall'), { key: 'Enter' })

    expect(jumpTo).toHaveBeenCalledWith(best)
    expect(setQuery).toHaveBeenCalledWith('')
  })

  it('clears the search on Escape without jumping anywhere', () => {
    const setQuery = vi.fn()
    const jumpTo = vi.fn()
    render(<WallSearch query="road" setQuery={setQuery} matches={[note('Roadmap')]} jumpTo={jumpTo} labelOf={labelOf} />)

    fireEvent.keyDown(screen.getByLabelText('Find on this wall'), { key: 'Escape' })

    expect(setQuery).toHaveBeenCalledWith('')
    expect(jumpTo).not.toHaveBeenCalled()
  })

  it('jumps to a result that is clicked, and names one that has no label', () => {
    const jumpTo = vi.fn()
    const untitled = note('')
    render(<WallSearch query="x" setQuery={vi.fn()} matches={[untitled]} jumpTo={jumpTo} labelOf={labelOf} />)

    fireEvent.click(screen.getByText('(untitled)'))

    expect(jumpTo).toHaveBeenCalledWith(untitled)
  })
})
