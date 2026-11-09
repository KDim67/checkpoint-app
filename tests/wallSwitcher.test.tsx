// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallSwitcher from '../src/renderer/src/components/wall/WallSwitcher'
import type { WallIndex } from '../src/shared/wallModel'

afterEach(cleanup)

const twoWalls: WallIndex = {
  version: 1,
  walls: [{ id: 'a', name: 'Ideas' }, { id: 'b', name: 'Roadmap' }],
  activeId: 'a'
}

type SwitcherProps = Parameters<typeof WallSwitcher>[0]

/** controlled, so menu and rename draft live here like in WallView */
function Harness({ index, commitIndex, duplicateWall, moveWall, setPendingDelete }: {
  index: WallIndex
  commitIndex: SwitcherProps['commitIndex']
  duplicateWall?: SwitcherProps['duplicateWall']
  moveWall?: SwitcherProps['moveWall']
  setPendingDelete: SwitcherProps['setPendingDelete']
}) {
  const [open, setOpen] = useState(true)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  return (
    <WallSwitcher
      wallIndex={index}
      activeWall={index.walls.find(w => w.id === index.activeId) ?? null}
      wallMenuOpen={open}
      setWallMenuOpen={setOpen}
      renaming={renaming}
      setRenaming={setRenaming}
      commitIndex={commitIndex}
      addWall={vi.fn()}
      duplicateWall={duplicateWall}
      moveWall={moveWall}
      setPendingDelete={setPendingDelete}
    />
  )
}

const renderSwitcher = (index = twoWalls) => {
  const commitIndex = vi.fn<SwitcherProps['commitIndex']>()
  const duplicateWall = vi.fn<NonNullable<SwitcherProps['duplicateWall']>>()
  const moveWall = vi.fn<NonNullable<SwitcherProps['moveWall']>>()
  const setPendingDelete = vi.fn<SwitcherProps['setPendingDelete']>()
  render(<Harness index={index} commitIndex={commitIndex} duplicateWall={duplicateWall} moveWall={moveWall} setPendingDelete={setPendingDelete} />)
  return { commitIndex, duplicateWall, moveWall, setPendingDelete }
}

describe('WallSwitcher', () => {
  it('opens the wall that is picked and closes the menu', () => {
    const { commitIndex } = renderSwitcher()

    fireEvent.click(screen.getByText('Roadmap'))

    expect(commitIndex).toHaveBeenCalledWith({ ...twoWalls, activeId: 'b' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renames a wall on Enter, with the name trimmed', () => {
    const { commitIndex } = renderSwitcher()

    fireEvent.click(screen.getByLabelText('Rename Roadmap'))
    fireEvent.change(screen.getByLabelText('Wall name'), { target: { value: '  Launch  ' } })
    fireEvent.keyDown(screen.getByLabelText('Wall name'), { key: 'Enter' })

    expect(commitIndex).toHaveBeenCalledTimes(1)
    expect(commitIndex.mock.calls[0][0].walls).toEqual([{ id: 'a', name: 'Ideas' }, { id: 'b', name: 'Launch' }])
    expect(screen.queryByLabelText('Wall name')).toBeNull()
  })

  it('keeps a typed name when the field loses focus', () => {
    const { commitIndex } = renderSwitcher()

    fireEvent.click(screen.getByLabelText('Rename Roadmap'))
    fireEvent.change(screen.getByLabelText('Wall name'), { target: { value: 'Launch' } })
    fireEvent.blur(screen.getByLabelText('Wall name'))

    expect(commitIndex.mock.calls[0][0].walls[1].name).toBe('Launch')
  })

  it('drops the edit on Escape', () => {
    const { commitIndex } = renderSwitcher()

    fireEvent.click(screen.getByLabelText('Rename Roadmap'))
    fireEvent.change(screen.getByLabelText('Wall name'), { target: { value: 'Launch' } })
    fireEvent.keyDown(screen.getByLabelText('Wall name'), { key: 'Escape' })

    expect(commitIndex).not.toHaveBeenCalled()
    expect(screen.getByText('Roadmap')).toBeTruthy()
  })

  it('duplicates a wall on click', () => {
    const { duplicateWall } = renderSwitcher()
    fireEvent.click(screen.getByLabelText('Duplicate Ideas'))
    expect(duplicateWall).toHaveBeenCalledWith(twoWalls.walls[0])
  })

  it('reorders walls with move up and move down buttons', () => {
    const { moveWall } = renderSwitcher()

    // Roadmap (index 1) can move up
    const moveRoadmapUp = screen.getByLabelText('Move Roadmap up') as HTMLButtonElement
    expect(moveRoadmapUp.disabled).toBe(false)
    fireEvent.click(moveRoadmapUp)
    expect(moveWall).toHaveBeenCalledWith('b', -1)

    // Ideas (index 0) cannot move up
    expect((screen.getByLabelText('Move Ideas up') as HTMLButtonElement).disabled).toBe(true)

    // Ideas (index 0) can move down
    const moveIdeasDown = screen.getByLabelText('Move Ideas down') as HTMLButtonElement
    expect(moveIdeasDown.disabled).toBe(false)
    fireEvent.click(moveIdeasDown)
    expect(moveWall).toHaveBeenCalledWith('a', 1)

    // Roadmap (index 1) cannot move down
    expect((screen.getByLabelText('Move Roadmap down') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reorders walls with Alt+Up and Alt+Down keyboard shortcuts', () => {
    const { moveWall } = renderSwitcher()
    fireEvent.keyDown(screen.getByTitle('Roadmap · Alt+Up/Down to reorder'), { key: 'ArrowUp', altKey: true })
    expect(moveWall).toHaveBeenCalledWith('b', -1)

    fireEvent.keyDown(screen.getByTitle('Ideas · Alt+Up/Down to reorder'), { key: 'ArrowDown', altKey: true })
    expect(moveWall).toHaveBeenCalledWith('a', 1)
  })

  it('offers delete only when another wall is left to fall back on', () => {
    const single: WallIndex = { version: 1, walls: [{ id: 'a', name: 'Ideas' }], activeId: 'a' }
    renderSwitcher(single)
    expect(screen.queryByLabelText('Delete Ideas')).toBeNull()
    cleanup()

    const { setPendingDelete } = renderSwitcher()
    fireEvent.click(screen.getByLabelText('Delete Roadmap'))

    expect(setPendingDelete).toHaveBeenCalledWith({ id: 'b', name: 'Roadmap' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
