// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallBinMenu from '../src/renderer/src/components/wall/WallBinMenu'
import type { WallBinEntry, WallItem } from '../src/shared/wallModel'

afterEach(cleanup)

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

function Menu({ entries, onRestore = vi.fn() }: { entries: WallBinEntry[]; onRestore?: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return <WallBinMenu open={open} setOpen={setOpen} entries={entries} labelOf={i => i.text} onRestore={onRestore} />
}

describe('WallBinMenu', () => {
  it('names each deletion by what was in it and when, and brings one back', () => {
    const onRestore = vi.fn()
    const entries: WallBinEntry[] = [
      {
        id: 'e1',
        at: Date.now() - 5 * 60_000,
        items: [item('a', { text: '**Launch** plan\nsecond line' }), item('b', { text: 'Budget' }), item('line', { kind: 'arrow', from: 'a', to: 'b' })]
      },
      { id: 'e2', at: Date.now() - 2 * 86_400_000, items: [item('ink', { kind: 'ink', points: [0, 0, 5, 5] })] }
    ]
    render(<Menu entries={entries} onRestore={onRestore} />)

    fireEvent.click(screen.getByLabelText('Recently deleted'))
    expect(screen.getByText('Launch plan and 1 more')).toBeTruthy()
    expect(screen.getByText('A drawing')).toBeTruthy()
    expect(screen.getByText('5m ago')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Restore Launch plan and 1 more'))
    expect(onRestore).toHaveBeenCalledWith('e1')
  })

  it('says when nothing has been deleted', () => {
    render(<Menu entries={[]} />)
    fireEvent.click(screen.getByLabelText('Recently deleted'))
    expect(screen.getByText('Nothing deleted from this wall in the last 30 days.')).toBeTruthy()
  })
})
