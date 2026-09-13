import type { Dispatch, SetStateAction } from 'react'
import { Eraser, Highlighter, LassoSelect, PenLine, Scissors, Spline } from 'lucide-react'
import { WALL_COLORS, STROKE_WIDTHS, SMOOTHING_STRENGTH, type ArrowShape, type ArrowLine, type ArrowHeads } from '../../../../shared/wallModel'
import WallColorPicker from './WallColorPicker'
import { setNumberSetting, setStringSetting } from '../../lib/settings'
import { arrowStyleButtons, toolButton } from './wallButtons'
import { SMOOTHING_KEY, ARROW_SHAPE_KEY, ARROW_LINE_KEY, ARROW_HEADS_KEY } from './wallPreferences'
import { isDrawTool, type DrawTool, type EraserMode, type WallTool } from './wallTools'
import type { PenPreset } from './wallPenPresets'

interface WallPenSettingsProps {
  tool: Exclude<WallTool, 'select'>
  setTool: Dispatch<SetStateAction<WallTool>>
  penColor: string
  /** the Wall's, which also updates the picked preset */
  setPenColor: (color: string) => void
  penWidth: number
  setPenWidth: (width: number) => void
  arrowShape: ArrowShape
  setArrowShape: Dispatch<SetStateAction<ArrowShape>>
  arrowLine: ArrowLine
  setArrowLine: Dispatch<SetStateAction<ArrowLine>>
  arrowHeads: ArrowHeads
  setArrowHeads: Dispatch<SetStateAction<ArrowHeads>>
  smoothing: boolean
  setSmoothing: Dispatch<SetStateAction<boolean>>
  eraserMode: EraserMode
  setEraserMode: (mode: EraserMode) => void
  /** the pen's or the highlighter's three, absent for the other tools */
  presets?: PenPreset[]
  activePreset?: number
  onPickPreset?: (index: number) => void
}

const MODES: { tool: DrawTool; label: string; icon: React.ReactNode }[] = [
  { tool: 'pen', label: 'Pen', icon: <PenLine size={13} /> },
  { tool: 'highlighter', label: 'Highlighter', icon: <Highlighter size={13} /> },
  { tool: 'eraser', label: 'Eraser', icon: <Eraser size={13} /> },
  { tool: 'lasso', label: 'Lasso select', icon: <LassoSelect size={13} /> }
]

const divider = <div style={{ height: '1px', width: '100%', background: 'var(--color-surface-offset)', margin: '2px 0' }} />

export default function WallPenSettings({
  tool, setTool, penColor, setPenColor, penWidth, setPenWidth, arrowShape, setArrowShape, arrowLine,
  setArrowLine, arrowHeads, setArrowHeads, smoothing, setSmoothing, eraserMode, setEraserMode,
  presets, activePreset, onPickPreset
}: WallPenSettingsProps) {
  // the eraser and lasso leave nothing on the wall, so nothing to colour or size
  const inks = tool === 'pen' || tool === 'highlighter' || tool === 'arrow'
  const strokes = tool === 'pen' || tool === 'highlighter'

  return (
    <div
      data-wall-ui
      role="group"
      aria-label="Pen settings"
      style={{
        position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)',
        zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
        padding: 'var(--space-2)',
        // a ceiling so the column doesn't run off a short window
        maxHeight: 'calc(100% - var(--space-6))', overflowY: 'auto', overflowX: 'hidden',
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)'
      }}
    >
      {isDrawTool(tool) && (
        <>
          {MODES.map(mode => toolButton(mode.label, mode.icon, () => setTool(mode.tool), { active: tool === mode.tool }))}
          {(inks || tool === 'eraser') && divider}
        </>
      )}

      {tool === 'eraser' && (
        <>
          {toolButton('Erase whole strokes', <Eraser size={13} />, () => setEraserMode('stroke'), { active: eraserMode === 'stroke' })}
          {toolButton('Erase part of a stroke', <Scissors size={13} />, () => setEraserMode('part'), { active: eraserMode === 'part' })}
        </>
      )}

      {strokes && presets && (
        <>
          {presets.map((preset, i) => (
            <button
              key={i}
              onClick={() => onPickPreset?.(i)}
              title={`Preset ${i + 1}. Colour and width changes are saved to it.`}
              aria-label={`Preset ${i + 1}`}
              aria-pressed={activePreset === i}
              style={{
                width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: activePreset === i ? 'var(--color-secondary-muted)' : 'none',
                border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                transition: 'background var(--duration-fast) var(--ease-default)'
              }}
            >
              <span style={{
                width: `${Math.min(18, preset.width * 1.5 + 6)}px`, height: `${Math.min(18, preset.width * 1.5 + 6)}px`,
                borderRadius: '50%', background: preset.color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.28)'
              }} />
            </button>
          ))}
          {divider}
        </>
      )}

      {inks && (
        <>
          <WallColorPicker
            colors={WALL_COLORS}
            value={penColor}
            onChange={setPenColor}
            columns={1}
          />

          {divider}

          {STROKE_WIDTHS.map(width => (
            <button
              key={width}
              onClick={() => setPenWidth(width)}
              title={`${width}px`}
              aria-label={`Stroke width ${width}`}
              aria-pressed={penWidth === width}
              style={{
                // 26 to match the swatches, one edge
                width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: penWidth === width ? 'var(--color-secondary-muted)' : 'none',
                border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                transition: 'background var(--duration-fast) var(--ease-default)'
              }}
            >
              <span style={{
                width: `${width + 6}px`, height: `${width}px`, borderRadius: '999px',
                background: penWidth === width ? 'var(--color-secondary)' : 'var(--color-text-muted)'
              }} />
            </button>
          ))}

          {divider}
        </>
      )}

      {tool === 'arrow' && arrowStyleButtons(
        arrowShape, arrowLine, arrowHeads,
        v => { setArrowShape(v); void setStringSetting(ARROW_SHAPE_KEY, v) },
        v => { setArrowLine(v); void setStringSetting(ARROW_LINE_KEY, v) },
        v => { setArrowHeads(v); void setStringSetting(ARROW_HEADS_KEY, v) },
        true
      )}

      {strokes && (
      <button
        onClick={() => {
          const next = !smoothing
          setSmoothing(next)
          void setNumberSetting(SMOOTHING_KEY, next ? SMOOTHING_STRENGTH : 0)
        }}
        title={smoothing ? 'Smoothing on' : 'Smoothing off'}
        aria-label="Smooth strokes"
        aria-pressed={smoothing}
        style={{
          width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: smoothing ? 'var(--color-secondary-muted)' : 'none',
          color: smoothing ? 'var(--color-secondary)' : 'var(--color-text-muted)',
          border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          transition: 'background var(--duration-fast) var(--ease-default)'
        }}
      >
        <Spline size={13} />
      </button>
      )}
    </div>
  )
}
