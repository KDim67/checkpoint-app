import React from 'react'
import { ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, SHAPE_TYPES, type ArrowShape, type ArrowLine, type ArrowHeads, type ShapeType } from '../../../../shared/wallModel'

/** buttons draw their option, no icon means "elbow" */
const glyphProps = {
  width: 15, height: 15, viewBox: '0 0 15 15',
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const
}

const SHAPE_GLYPHS: Record<ArrowShape, string> = {
  straight: 'M2 12L13 3',
  curved: 'M2 12Q3 3 13 4',
  elbow: 'M2 12H8V3H13'
}

const shapeGlyph = (shape: ArrowShape): React.JSX.Element => (
  <svg {...glyphProps}><path d={SHAPE_GLYPHS[shape]} /></svg>
)

const lineGlyph = (line: ArrowLine): React.JSX.Element => (
  <svg {...glyphProps} strokeWidth={2}>
    <path d="M2 7.5H13" strokeDasharray={line === 'dashed' ? '4 3' : line === 'dotted' ? '0.5 3' : undefined} />
  </svg>
)

const headsGlyph = (heads: ArrowHeads): React.JSX.Element => (
  <svg {...glyphProps}>
    <path d="M2 7.5H13" />
    {heads !== 'none' && <path d="M10 4.5L13 7.5L10 10.5" />}
    {heads === 'both' && <path d="M5 4.5L2 7.5L5 10.5" />}
  </svg>
)

/** sentence case for tooltips */
const nameOf = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

/** one cycling button per property keeps the palette one column */
const cycleButton = <T extends string>(
  label: string,
  options: readonly T[],
  current: T,
  glyph: (value: T) => React.ReactNode,
  onPick: (next: T) => void,
  compact = false
): React.JSX.Element => {
  const next = options[(options.indexOf(current) + 1) % options.length]
  const size = compact ? '26px' : '30px'
  return (
    <button
      key={label}
      onClick={() => onPick(next)}
      title={`${label}: ${nameOf(current)}. Click for ${nameOf(next)}.`}
      aria-label={`${label}: ${nameOf(current)}`}
      className="bg-clear text-muted hover-text-accent wall-cycle-button"
      style={{
        width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)'
      }}
    >
      {glyph(current)}
    </button>
  )
}

/** shared by palette and toolbar */
export const arrowStyleButtons = (
  shape: ArrowShape,
  line: ArrowLine,
  heads: ArrowHeads,
  onShape: (v: ArrowShape) => void,
  onLine: (v: ArrowLine) => void,
  onHeads: (v: ArrowHeads) => void,
  compact = false
): React.JSX.Element[] => [
  cycleButton('Route', ARROW_SHAPES, shape, shapeGlyph, onShape, compact),
  cycleButton('Line', ARROW_LINES, line, lineGlyph, onLine, compact),
  cycleButton('Heads', ARROW_HEAD_MODES, heads, headsGlyph, onHeads, compact)
]

const OUTLINE_GLYPHS: Record<ShapeType, React.JSX.Element> = {
  rectangle: <rect x="2" y="3.5" width="11" height="8" />,
  rounded: <rect x="2" y="3.5" width="11" height="8" rx="2.5" />,
  oval: <ellipse cx="7.5" cy="7.5" rx="5.5" ry="4" />,
  diamond: <path d="M7.5 2L13 7.5L7.5 13L2 7.5Z" />,
  triangle: <path d="M7.5 2.5L13 12H2Z" />
}

/** one cycling button like the arrow styles, five outlines laid flat would crowd the bar */
export const shapeButton = (current: ShapeType, onPick: (next: ShapeType) => void): React.JSX.Element =>
  cycleButton('Shape', SHAPE_TYPES, current, shape => <svg {...glyphProps}>{OUTLINE_GLYPHS[shape]}</svg>, onPick)

/** accent plus underline, hover already paints surface-offset */
export const toolButton = (
  label: string,
  icon: React.ReactNode,
  onClick: () => void,
  opts: { active?: boolean; disabled?: boolean; shortcut?: string } = {}
): React.JSX.Element => {
  // key in the tooltip, 30px only fits the icon
  const described = opts.shortcut ? `${label} (${opts.shortcut})` : label
  return (
  <button
    key={label}
    onClick={onClick}
    title={described}
    aria-label={described}
    aria-keyshortcuts={opts.shortcut}
    aria-pressed={opts.active}
    disabled={opts.disabled}
    className="btn-icon"
    style={{
      position: 'relative',
      width: '30px', height: '30px',
      background: opts.active ? 'var(--color-secondary-muted)' : undefined,
      color: opts.active ? 'var(--color-secondary)' : undefined,
      opacity: opts.disabled ? 0.4 : 1,
      cursor: opts.disabled ? 'not-allowed' : 'pointer'
    }}
  >
    {icon}
    {opts.active && (
      <span
        aria-hidden
        style={{
          position: 'absolute', left: '6px', right: '6px', bottom: '3px', height: '2px',
          borderRadius: '999px', background: 'var(--color-secondary)'
        }}
      />
    )}
  </button>
  )
}
