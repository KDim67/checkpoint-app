// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallFramesMenu from '../src/renderer/src/components/wall/WallFramesMenu'
import type { WallItem } from '../src/shared/wallModel'

afterEach(cleanup)

const frame = (id: string, text?: string): WallItem =>
  ({ id, kind: 'frame', x: 0, y: 0, width: 400, height: 300, z: 0, ...(text ? { text } : {}) })

function Menu({ frames, onShow = vi.fn(), onPresent = vi.fn(), onReorder = vi.fn(), custom = false, onResetOrder = vi.fn() }: {
  frames: WallItem[]
  onShow?: (frame: WallItem) => void
  onPresent?: (index: number) => void
  onReorder?: (ids: string[]) => void
  custom?: boolean
  onResetOrder?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <WallFramesMenu
      open={open}
      setOpen={setOpen}
      frames={frames}
      onShow={onShow}
      onPresent={onPresent}
      onReorder={onReorder}
      customOrder={custom}
      onResetOrder={onResetOrder}
    />
  )
}

const row = (label: string): HTMLElement => screen.getByText(label).closest('[draggable]') as HTMLElement

describe('WallFramesMenu', () => {
  it('lists frames by name in order, and jumps to one', () => {
    const frames = [frame('a', 'Intro'), frame('b')]
    const onShow = vi.fn()
    render(<Menu frames={frames} onShow={onShow} />)

    fireEvent.click(screen.getByLabelText('Frames'))
    expect(screen.getByText('Intro')).toBeTruthy()
    fireEvent.click(screen.getByText('Frame 2'))

    expect(onShow).toHaveBeenCalledWith(frames[1])
    expect(screen.queryByText('Intro')).toBeNull()
  })

  it('presents from the first frame', () => {
    const onPresent = vi.fn()
    render(<Menu frames={[frame('a')]} onPresent={onPresent} />)

    fireEvent.click(screen.getByLabelText('Frames'))
    fireEvent.click(screen.getByText('Present'))

    expect(onPresent).toHaveBeenCalledWith(0)
  })

  it('reorders frames by dragging one onto another', () => {
    const onReorder = vi.fn()
    render(<Menu frames={[frame('a', 'A'), frame('b', 'B'), frame('c', 'C')]} onReorder={onReorder} />)
    fireEvent.click(screen.getByLabelText('Frames'))

    fireEvent.dragStart(row('C'))
    fireEvent.dragOver(row('A'))
    fireEvent.drop(row('A'))

    expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b'])
  })

  it('moves a frame with Alt and the arrow keys, and goes back to reading order', () => {
    const onReorder = vi.fn()
    const onResetOrder = vi.fn()
    render(<Menu frames={[frame('a', 'A'), frame('b', 'B'), frame('c', 'C')]} onReorder={onReorder} custom onResetOrder={onResetOrder} />)
    fireEvent.click(screen.getByLabelText('Frames'))

    fireEvent.keyDown(row('A'), { key: 'ArrowDown', altKey: true })
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c'])

    fireEvent.click(screen.getByText('Back to reading order'))
    expect(onResetOrder).toHaveBeenCalled()
  })

  it('says how to make a frame when there are none, and has nothing to present', () => {
    render(<Menu frames={[]} />)
    fireEvent.click(screen.getByLabelText('Frames'))

    expect(screen.getByText(/No frames yet/)).toBeTruthy()
    expect((screen.getByText('Present').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
