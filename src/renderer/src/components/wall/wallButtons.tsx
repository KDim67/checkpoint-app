import React from 'react'
import {
  ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, SHAPE_TYPES, TEXT_ALIGNS,
  WALL_FONTS, WALL_FONT_NAMES,
  type ArrowShape, type ArrowLine, type ArrowHeads, type ShapeType, type TextAlign, type WallFont
} from '../../../../shared/wallModel'
import { SHAPE_NAMES } from '../../../../shared/wallShape'

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

const arrowRouteGlyph = (shape: ArrowShape): React.JSX.Element => (
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
  compact = false,
  /** when the stored value isn't the word people say */
  names: Partial<Record<T, string>> = {}
): React.JSX.Element => {
  const next = options[(options.indexOf(current) + 1) % options.length]
  const size = compact ? '26px' : '30px'
  const name = (value: T): string => names[value] ?? nameOf(value)
  return (
    <button
      key={label}
      onClick={() => onPick(next)}
      title={`${label}: ${name(current)}. Click for ${name(next)}.`}
      aria-label={`${label}: ${name(current)}`}
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
  cycleButton('Route', ARROW_SHAPES, shape, arrowRouteGlyph, onShape, compact),
  cycleButton('Line', ARROW_LINES, line, lineGlyph, onLine, compact),
  cycleButton('Heads', ARROW_HEAD_MODES, heads, headsGlyph, onHeads, compact)
]

export const OUTLINE_GLYPHS: Record<ShapeType, React.JSX.Element> = {
  rectangle: <rect x="2" y="3.5" width="11" height="8" />,
  rounded: <rect x="2" y="3.5" width="11" height="8" rx="2.5" />,
  oval: <ellipse cx="7.5" cy="7.5" rx="5.5" ry="4" />,
  diamond: <path d="M7.5 2L13 7.5L7.5 13L2 7.5Z" />,
  triangle: <path d="M7.5 2.5L13 12H2Z" />
}

export const shapeGlyph = (shape: ShapeType): React.JSX.Element => (
  <svg {...glyphProps}>{OUTLINE_GLYPHS[shape]}</svg>
)

export interface ShapePickerMenuProps {
  current?: ShapeType
  onPick: (shape: ShapeType) => void
  onClose?: () => void
}

export function ShapePickerMenu({ current, onPick, onClose }: ShapePickerMenuProps): React.JSX.Element {
  return (
    <div
      role="menu"
      aria-label="Pick a shape"
      data-wall-ui
      onPointerDown={e => e.stopPropagation()}
      style={{
        display: 'flex',
        gap: '4px',
        padding: '6px',
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)'
      }}
    >
      {SHAPE_TYPES.map(shape => {
        const isSelected = current === shape
        return (
          <button
            key={shape}
            type="button"
            role="menuitem"
            title={SHAPE_NAMES[shape] ?? nameOf(shape)}
            aria-label={SHAPE_NAMES[shape] ?? nameOf(shape)}
            onClick={() => {
              onPick(shape)
              onClose?.()
            }}
            className="wall-cycle-button"
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: isSelected ? '1px solid var(--color-primary)' : '1px solid transparent',
              borderRadius: 'var(--radius-sm)',
              background: isSelected ? 'var(--color-primary-muted)' : 'transparent',
              color: isSelected ? 'var(--color-primary)' : 'var(--color-text-base)',
              cursor: 'pointer'
            }}
          >
            {shapeGlyph(shape)}
          </button>
        )
      })}
    </div>
  )
}

/** direct shape picker replaces click-to-cycle */
export const shapeButton = (current: ShapeType, onPick: (next: ShapeType) => void): React.JSX.Element =>
  cycleButton('Shape', SHAPE_TYPES, current, shape => <svg {...glyphProps}>{OUTLINE_GLYPHS[shape]}</svg>, onPick, false, SHAPE_NAMES)

const ALIGN_GLYPHS: Record<TextAlign, string> = {
  left: 'M2 4H13M2 7.5H9M2 11H11',
  center: 'M2 4H13M4 7.5H11M3 11H12',
  right: 'M2 4H13M6 7.5H13M4 11H13'
}

/** the side words sit on, cycled like the other looks; stored as CSS spells it */
export const textAlignButton = (current: TextAlign, onPick: (next: TextAlign) => void): React.JSX.Element =>
  cycleButton('Text alignment', TEXT_ALIGNS, current, side => <svg {...glyphProps}><path d={ALIGN_GLYPHS[side]} /></svg>, onPick, false, { center: 'Centre' })

export function fontCssFamily(font?: WallFont): string {
  switch (font) {
    case 'serif':
      return 'Georgia, Cambria, "Times New Roman", Times, serif'
    case 'mono':
      return 'var(--font-mono), monospace'
    case 'handwriting':
      return '"Caveat", "Segoe Print", "Bradley Hand", cursive, sans-serif'
    case 'rounded':
      return '"Nunito", "Quicksand", "Arial Rounded MT Bold", sans-serif'
    case 'display':
      return 'Impact, "Trebuchet MS", "Arial Black", sans-serif'
    case 'typewriter':
      return '"Courier New", "Lucida Console", Courier, monospace'
    case 'comic':
      return '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive, sans-serif'
    case 'sans':
    default:
      return 'var(--font-sans), sans-serif'
  }
}

export function fontGlyph(font?: WallFont): string {
  switch (font) {
    case 'serif':
      return 'T'
    case 'mono':
      return '{}'
    case 'handwriting':
      return 'Hw'
    case 'rounded':
      return 'Rd'
    case 'display':
      return 'Ds'
    case 'typewriter':
      return 'Ty'
    case 'comic':
      return 'Cm'
    case 'sans':
    default:
      return 'Ag'
  }
}

export interface FontPickerMenuProps {
  current?: WallFont
  onPick: (font: WallFont) => void
  onClose?: () => void
}

export function FontPickerMenu({ current = 'sans', onPick, onClose }: FontPickerMenuProps): React.JSX.Element {
  return (
    <div
      role="menu"
      aria-label="Pick a font family"
      data-wall-ui
      onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Escape') onClose?.()
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '4px',
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        minWidth: '150px'
      }}
    >
      <div
        style={{
          padding: '4px 8px 3px',
          fontSize: '10px',
          fontWeight: 600,
          color: 'var(--color-text-faint)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        Font family
      </div>
      {WALL_FONTS.map(font => {
        const isSelected = current === font
        return (
          <button
            key={font}
            type="button"
            role="menuitem"
            aria-label={WALL_FONT_NAMES[font]}
            aria-selected={isSelected}
            onClick={() => {
              onPick(font)
              onClose?.()
            }}
            className="hover-bg-offset"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '6px 10px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: isSelected ? 'var(--color-primary-muted)' : 'transparent',
              color: isSelected ? 'var(--color-primary)' : 'var(--color-text-base)',
              fontFamily: fontCssFamily(font),
              fontSize: '13px',
              fontWeight: isSelected ? 600 : 400,
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <span>{WALL_FONT_NAMES[font]}</span>
            {isSelected && (
              <span
                style={{
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  letterSpacing: '0.02em'
                }}
              >
                Active
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export const fontButton = (current: WallFont = 'sans', onPick: (next: WallFont) => void): React.JSX.Element =>
  cycleButton(
    'Font family',
    WALL_FONTS,
    current,
    font => (
      <span style={{
        fontSize: '11px',
        fontWeight: 600,
        fontFamily: fontCssFamily(font),
        lineHeight: 1
      }}>
        {fontGlyph(font)}
      </span>
    ),
    onPick,
    false,
    WALL_FONT_NAMES
  )

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
