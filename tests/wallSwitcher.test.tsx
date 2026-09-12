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

/** The switcher is controlled, so the open menu and the rename draft live here the way they do in WallView. */
function Harness({ index, commitIndex, setPendingDelete }: {
  index: WallIndex
  commitIndex: SwitcherProps['commitIndex']
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
      setPendingDelete={setPendingDelete}
    />
  )
}

const renderSwitcher = (index = twoWalls) => {
  const commitIndex = vi.fn<SwitcherProps['commitIndex']>()
  const setPendingDelete = vi.fn<SwitcherProps['setPendingDelete']>()
  render(<Harness index={index} commitIndex={commitIndex} setPendingDelete={setPendingDelete} />)
  return { commitIndex, setPendingDelete }
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
