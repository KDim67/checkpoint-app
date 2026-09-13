// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallPenSettings from '../src/renderer/src/components/wall/WallPenSettings'
import { ARROW_HEADS_KEY, ARROW_LINE_KEY, ARROW_SHAPE_KEY, SMOOTHING_KEY } from '../src/renderer/src/components/wall/wallPreferences'
import { setSetting } from '../src/renderer/src/data/settings'
import { SMOOTHING_STRENGTH, WALL_COLORS, type ArrowHeads, type ArrowLine, type ArrowShape } from '../src/shared/wallModel'
import type { EraserMode, WallTool } from '../src/renderer/src/components/wall/wallTools'
import { DEFAULT_PEN_PRESETS } from '../src/renderer/src/components/wall/wallPenPresets'

vi.mock('../src/renderer/src/data/settings', () => ({ getSetting: vi.fn(), setSetting: vi.fn(async () => {}) }))

beforeEach(() => vi.mocked(setSetting).mockClear())
afterEach(cleanup)

/** Wall state, held by the harness the same way */
function Palette({ tool: initial }: { tool: Exclude<WallTool, 'select'> }) {
  const [tool, setTool] = useState<WallTool>(initial)
  const [penColor, setPenColor] = useState(WALL_COLORS[0])
  const [penWidth, setPenWidth] = useState(4)
  const [arrowShape, setArrowShape] = useState<ArrowShape>('straight')
  const [arrowLine, setArrowLine] = useState<ArrowLine>('solid')
  const [arrowHeads, setArrowHeads] = useState<ArrowHeads>('end')
  const [smoothing, setSmoothing] = useState(false)
  const [eraserMode, setEraserMode] = useState<EraserMode>('stroke')
  const [preset, setPreset] = useState(0)
  const presets = DEFAULT_PEN_PRESETS.pen
  return (
    <WallPenSettings
      tool={tool === 'select' ? 'pen' : tool}
      setTool={setTool}
      eraserMode={eraserMode}
      setEraserMode={setEraserMode}
      presets={presets}
      activePreset={preset}
      onPickPreset={i => { setPreset(i); setPenColor(presets[i].color); setPenWidth(presets[i].width) }}
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

  it('switches between pen, highlighter, eraser and lasso, showing only what each one needs', () => {
    render(<Palette tool="pen" />)
    expect(pressed('Pen')).toBe('true')

    fireEvent.click(screen.getByLabelText('Eraser'))
    expect(pressed('Eraser')).toBe('true')
    expect(screen.queryByLabelText('Stroke width 4')).toBeNull()
    expect(screen.queryByLabelText(WALL_COLORS[0])).toBeNull()

    fireEvent.click(screen.getByLabelText('Highlighter'))
    expect(screen.getByLabelText('Stroke width 4')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Lasso select'))
    expect(screen.queryByLabelText('Smooth strokes')).toBeNull()
  })

  it('erases whole strokes, or just the part it touches', () => {
    render(<Palette tool="eraser" />)
    expect(pressed('Erase whole strokes')).toBe('true')

    fireEvent.click(screen.getByLabelText('Erase part of a stroke'))

    expect(pressed('Erase part of a stroke')).toBe('true')
    expect(pressed('Erase whole strokes')).toBe('false')
  })

  it('picks a saved preset for the pen, and shows none for the eraser', () => {
    render(<Palette tool="pen" />)
    expect(pressed('Preset 1')).toBe('true')

    fireEvent.click(screen.getByLabelText('Preset 2'))

    expect(pressed('Preset 2')).toBe('true')
    expect(pressed(DEFAULT_PEN_PRESETS.pen[1].color)).toBe('true')
    cleanup()

    render(<Palette tool="eraser" />)
    expect(screen.queryByLabelText('Preset 1')).toBeNull()
  })

  it('offers no drawing modes to the arrow tool', () => {
    render(<Palette tool="arrow" />)
    expect(screen.queryByLabelText('Eraser')).toBeNull()
  })

  it('comes back round to the first route after the last', () => {
    render(<Palette tool="arrow" />)

    fireEvent.click(screen.getByLabelText('Route: Straight'))
    fireEvent.click(screen.getByLabelText('Route: Curved'))
    fireEvent.click(screen.getByLabelText('Route: Elbow'))

    expect(screen.getByLabelText('Route: Straight')).toBeTruthy()
  })
})
