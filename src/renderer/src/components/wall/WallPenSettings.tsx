import type { Dispatch, SetStateAction } from 'react'
import { Spline } from 'lucide-react'
import { WALL_COLORS, STROKE_WIDTHS, SMOOTHING_STRENGTH, type ArrowShape, type ArrowLine, type ArrowHeads } from '../../../../shared/wallModel'
import WallColorPicker from './WallColorPicker'
import { setNumberSetting, setStringSetting } from '../../lib/settings'
import { arrowStyleButtons } from './wallButtons'
import { SMOOTHING_KEY, ARROW_SHAPE_KEY, ARROW_LINE_KEY, ARROW_HEADS_KEY } from './wallPreferences'

interface WallPenSettingsProps {
  tool: 'pen' | 'arrow'
  penColor: string
  setPenColor: Dispatch<SetStateAction<string>>
  penWidth: number
  setPenWidth: Dispatch<SetStateAction<number>>
  arrowShape: ArrowShape
  setArrowShape: Dispatch<SetStateAction<ArrowShape>>
  arrowLine: ArrowLine
  setArrowLine: Dispatch<SetStateAction<ArrowLine>>
  arrowHeads: ArrowHeads
  setArrowHeads: Dispatch<SetStateAction<ArrowHeads>>
  smoothing: boolean
  setSmoothing: Dispatch<SetStateAction<boolean>>
}

export default function WallPenSettings({
  tool, penColor, setPenColor, penWidth, setPenWidth, arrowShape, setArrowShape, arrowLine,
  setArrowLine, arrowHeads, setArrowHeads, smoothing, setSmoothing
}: WallPenSettingsProps) {
  return (
    <div
      data-wall-ui
      role="group"
      aria-label="Pen settings"
      style={{
        position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)',
        zIndex: 20, display: 'flex', flexDirection: 'column', gap: '6px',
        padding: 'var(--space-2)',
        // A single column is tall, so it gets a ceiling rather than
        // running off the bottom of a short window.
        maxHeight: 'calc(100% - var(--space-6))', overflowY: 'auto', overflowX: 'hidden',
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)'
      }}
    >
      <WallColorPicker
        colors={WALL_COLORS}
        value={penColor}
        onChange={setPenColor}
        columns={1}
      />

      <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '2px 0' }} />

      {STROKE_WIDTHS.map(width => (
        <button
          key={width}
          onClick={() => setPenWidth(width)}
          title={`${width}px`}
          aria-label={`Stroke width ${width}`}
          aria-pressed={penWidth === width}
          style={{
            // 26 to match the swatches above it, so the strip has one edge.
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

      <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '2px 0' }} />

      {tool === 'arrow' && arrowStyleButtons(
        arrowShape, arrowLine, arrowHeads,
        v => { setArrowShape(v); void setStringSetting(ARROW_SHAPE_KEY, v) },
        v => { setArrowLine(v); void setStringSetting(ARROW_LINE_KEY, v) },
        v => { setArrowHeads(v); void setStringSetting(ARROW_HEADS_KEY, v) },
        true
      )}

      {tool === 'pen' && (
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
