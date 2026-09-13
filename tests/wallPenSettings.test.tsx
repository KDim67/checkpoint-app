// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallPenSettings from '../src/renderer/src/components/wall/WallPenSettings'
import { ARROW_HEADS_KEY, ARROW_LINE_KEY, ARROW_SHAPE_KEY, SMOOTHING_KEY } from '../src/renderer/src/components/wall/wallPreferences'
import { setSetting } from '../src/renderer/src/data/settings'
import { SMOOTHING_STRENGTH, WALL_COLORS, type ArrowHeads, type ArrowLine, type ArrowShape } from '../src/shared/wallModel'

vi.mock('../src/renderer/src/data/settings', () => ({ getSetting: vi.fn(), setSetting: vi.fn(async () => {}) }))

beforeEach(() => vi.mocked(setSetting).mockClear())
afterEach(cleanup)

/** Wall state, held by the harness the same way */
function Palette({ tool }: { tool: 'pen' | 'arrow' }) {
  const [penColor, setPenColor] = useState(WALL_COLORS[0])
  const [penWidth, setPenWidth] = useState(4)
  const [arrowShape, setArrowShape] = useState<ArrowShape>('straight')
  const [arrowLine, setArrowLine] = useState<ArrowLine>('solid')
  const [arrowHeads, setArrowHeads] = useState<ArrowHeads>('end')
  const [smoothing, setSmoothing] = useState(false)
  return (
    <WallPenSettings
      tool={tool}
      penColor={penColor} setPenColor={setPenColor}
      penWidth={penWidth} setPenWidth={setPenWidth}
      arrowShape={arrowShape} setArrowShape={setArrowShape}
      arrowLine={arrowLine} setArrowLine={setArrowLine}
      arrowHeads={arrowHeads} setArrowHeads={setArrowHeads}
      smoothing={smoothing} setSmoothing={setSmoothing}
    />
  )
}

const pressed = (label: string) => screen.getByLabelText(label).getAttribute('aria-pressed')

describe('WallPenSettings', () => {
  it('picks one stroke width at a time', () => {
    render(<Palette tool="pen" />)
    expect(pressed('Stroke width 4')).toBe('true')

    fireEvent.click(screen.getByLabelText('Stroke width 8'))

    expect(pressed('Stroke width 8')).toBe('true')
    expect(pressed('Stroke width 4')).toBe('false')
  })

  it('picks the ink colour from the strip', () => {
    render(<Palette tool="pen" />)

    fireEvent.click(screen.getByLabelText(WALL_COLORS[2]))

    expect(pressed(WALL_COLORS[2])).toBe('true')
    expect(pressed(WALL_COLORS[0])).toBe('false')
  })

  it('turns smoothing on and off for the pen, and remembers it', () => {
    render(<Palette tool="pen" />)
    expect(screen.queryByLabelText(/^Route:/)).toBeNull()

    fireEvent.click(screen.getByLabelText('Smooth strokes'))
    expect(pressed('Smooth strokes')).toBe('true')
    expect(setSetting).toHaveBeenLastCalledWith(SMOOTHING_KEY, String(SMOOTHING_STRENGTH))

    fireEvent.click(screen.getByLabelText('Smooth strokes'))
    expect(pressed('Smooth strokes')).toBe('false')
    expect(setSetting).toHaveBeenLastCalledWith(SMOOTHING_KEY, '0')
  })

  it('moves each arrow style to its next option for the arrow tool, and remembers it', () => {
    render(<Palette tool="arrow" />)
    expect(screen.queryByLabelText('Smooth strokes')).toBeNull()

    fireEvent.click(screen.getByLabelText('Route: Straight'))
    expect(screen.getByLabelText('Route: Curved')).toBeTruthy()
    expect(setSetting).toHaveBeenLastCalledWith(ARROW_SHAPE_KEY, 'curved')

    fireEvent.click(screen.getByLabelText('Line: Solid'))
    expect(screen.getByLabelText('Line: Dashed')).toBeTruthy()
    expect(setSetting).toHaveBeenLastCalledWith(ARROW_LINE_KEY, 'dashed')

    fireEvent.click(screen.getByLabelText('Heads: End'))
    expect(screen.getByLabelText('Heads: Both')).toBeTruthy()
    expect(setSetting).toHaveBeenLastCalledWith(ARROW_HEADS_KEY, 'both')
  })

  it('comes back round to the first route after the last', () => {
    render(<Palette tool="arrow" />)

    fireEvent.click(screen.getByLabelText('Route: Straight'))
    fireEvent.click(screen.getByLabelText('Route: Curved'))
    fireEvent.click(screen.getByLabelText('Route: Elbow'))

    expect(screen.getByLabelText('Route: Straight')).toBeTruthy()
  })
})
