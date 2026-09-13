// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallExportMenu, { type ExportChoice } from '../src/renderer/src/components/wall/WallExportMenu'

afterEach(cleanup)

function Menu(props: { hasItems: boolean; hasSelection: boolean; frameCount: number; onExport?: (choice: ExportChoice) => void }) {
  const [open, setOpen] = useState(false)
  return <WallExportMenu open={open} setOpen={setOpen} onExport={vi.fn()} {...props} />
}

const option = (text: string): HTMLButtonElement => screen.getByText(text).closest('button') as HTMLButtonElement

describe('WallExportMenu', () => {
  it('exports the wall, the selection, an SVG or a PDF of the frames, closing each time', () => {
    const onExport = vi.fn()
    render(<Menu hasItems hasSelection frameCount={3} onExport={onExport} />)

    const choices: [string, ExportChoice][] = [
      ['Whole wall as PNG', 'png'],
      ['Selection as PNG', 'selection'],
      ['Whole wall as SVG', 'svg'],
      ['Frames as PDF, a page each', 'pdf'],
      ['Words as CSV', 'csv']
    ]
    for (const [label, choice] of choices) {
      fireEvent.click(screen.getByLabelText('Export'))
      fireEvent.click(option(label))
      expect(onExport).toHaveBeenLastCalledWith(choice)
      expect(screen.queryByText(label)).toBeNull()
    }
  })

  it('greys out the selection without one, and makes the PDF one page with no frames', () => {
    render(<Menu hasItems hasSelection={false} frameCount={0} />)
    fireEvent.click(screen.getByLabelText('Export'))

    expect(option('Selection as PNG').disabled).toBe(true)
    expect(screen.getByText('Whole wall as PDF')).toBeTruthy()
  })

  it('has nothing to export from an empty wall', () => {
    render(<Menu hasItems={false} hasSelection={false} frameCount={0} />)
    expect((screen.getByLabelText('Export') as HTMLButtonElement).disabled).toBe(true)
  })
})
