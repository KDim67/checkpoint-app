import { useState, type CSSProperties, type Dispatch, type ReactNode, type Ref, type SetStateAction } from 'react'
import {
  Type, Trash2, ArrowUp, ArrowDown, Copy, Lock, Unlock, Link2, Group, Ungroup, SlidersHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, Tags, Crop, RotateCw
} from 'lucide-react'
import { bringToFront, fontSizeOf, patchItems, sendToBack, WALL_COLORS, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, SHAPE_TYPES, type WallItem } from '../../../../shared/wallModel'
import { isLinkable } from '../../../../shared/wallLink'
import { alignableUnits, alignItems, distributeItems, type AlignEdge } from '../../../../shared/wallAlign'
import { groupItems, groupState, ungroupItems } from '../../../../shared/wallGroup'
import { isWritable, textAlignOf } from '../../../../shared/wallShape'
import { tagsOn } from '../../../../shared/wallTags'
import { CODE_LANGUAGES } from '../../../../shared/wallCode'
import WallColorPicker from './WallColorPicker'
import WallLinkEditor from './WallLinkEditor'
import WallTagEditor from './WallTagEditor'
import { toolButton, arrowStyleButtons, textAlignButton, shapeGlyph, ShapePickerMenu } from './wallButtons'
import { ColorA, FontSelect, SizeStepper } from './wallTextControls'
import { restyleBoxes } from '../../../../shared/wallText'

interface WallSelectionBarProps {
  floatingPos: { left: number; top: number }
  floatingRef: Ref<HTMLDivElement>
  swatchOpen: boolean
  setSwatchOpen: Dispatch<SetStateAction<boolean>>
  /** shared with the menu, so "line up and space out" there opens this panel */
  alignOpen: boolean
  setAlignOpen: Dispatch<SetStateAction<boolean>>
  linkOpen: boolean
  setLinkOpen: Dispatch<SetStateAction<boolean>>
  single: WallItem | null
  /** how the single item's link reads on its chip */
  linkLabel?: string
  arrowsSelected: boolean
  items: WallItem[]
  selectedIds: Set<string>
  /** record: false while a slider moves, one undo step when it's let go */
  setItems: (items: WallItem[], opts?: { record?: boolean }) => void
  setEditingId: Dispatch<SetStateAction<string | null>>
  duplicateSelected: () => void
  toggleLock: () => void
  removeSelected: () => void
  setItemLink: (id: string, link: string | undefined) => void
  startLinkPick: (id: string) => void
  followLink: (link: string) => void
  /** the board's tag names, and their colours by lowercased name */
  tagNames: string[]
  tagColors: Map<string, string>
  onAddTag: (name: string) => void
  onRemoveTag: (name: string) => void
  onGatherTags: () => void
  /** opens the crop window over a single picture */
  onCropImage: (id: string) => void
  /** a quarter turn, clockwise for a positive number */
  onTurn: (degrees: number) => void
  /** a colour picked for stickies, which the next new one takes */
  onStickyColor?: (color: string) => void
}

const popover = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 42,
  background: 'var(--color-surface-elevated)',
  border: '1px solid var(--color-surface-offset)',
  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
} as const

const fieldLabel: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '4px',
  fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)'
}

/** one value when every selected box agrees, null when they don't */
function agreed<T>(values: T[]): T | null | undefined {
  if (values.length === 0) return undefined
  return values.every(v => v === values[0]) ? values[0] : null
}

/** a row across, a row down, laid out like the lines they make */
const ALIGN: { edge: AlignEdge; label: string; icon: ReactNode }[] = [
  { edge: 'left', label: 'Align left edges', icon: <AlignStartVertical size={13} /> },
  { edge: 'centre', label: 'Centre in a column', icon: <AlignCenterVertical size={13} /> },
  { edge: 'right', label: 'Align right edges', icon: <AlignEndVertical size={13} /> },
  { edge: 'top', label: 'Align top edges', icon: <AlignStartHorizontal size={13} /> },
  { edge: 'middle', label: 'Centre in a row', icon: <AlignCenterHorizontal size={13} /> },
  { edge: 'bottom', label: 'Align bottom edges', icon: <AlignEndHorizontal size={13} /> }
]

export default function WallSelectionBar({
  floatingPos, floatingRef, swatchOpen, setSwatchOpen, alignOpen, setAlignOpen, linkOpen, setLinkOpen, single, linkLabel,
  arrowsSelected, items, selectedIds, setItems, setEditingId, duplicateSelected, toggleLock,
  removeSelected, setItemLink, startLinkPick, followLink, tagNames, tagColors, onAddTag, onRemoveTag,
  onGatherTags, onCropImage, onTurn, onStickyColor
}: WallSelectionBarProps) {
  // restyling an outline needs every selected item to be a shape, like the arrow styles
  const chosen = items.filter(i => selectedIds.has(i.id))
  const shapesSelected = chosen.length > 0 && chosen.every(i => i.kind === 'shape')
  const wordsSelected = chosen.length > 0 && chosen.every(i => isWritable(i.kind))
  // tags belong to stickies, and a language to code blocks
  const stickiesSelected = chosen.length > 0 && chosen.every(i => i.kind === 'note')
  const codeSelected = chosen.length > 0 && chosen.every(i => i.kind === 'code')
  const roundedSelected = chosen.some(i => i.kind === 'shape' && i.shape === 'rounded')
  const textOnly = chosen.length > 0 && chosen.every(i => i.kind === 'text')
  // a group is one piece; a single item has nothing to line up with, so skip the count
  const pieces = chosen.length >= 2 ? alignableUnits(items, selectedIds) : chosen.length
  const { canGroup, canUngroup } = groupState(items, selectedIds)
  // tied to the selection that opened them, a new pick closes them without an effect
  const [styleFor, setStyleFor] = useState<Set<string> | null>(null)
  const [shapePickerFor, setShapePickerFor] = useState<Set<string> | null>(null)
  const [tagsFor, setTagsFor] = useState<Set<string> | null>(null)
  const styleOpen = styleFor === selectedIds
  const shapePickerOpen = shapePickerFor === selectedIds
  const tagsOpen = tagsFor === selectedIds
  const closeOthers = (): void => {
    setSwatchOpen(false)
    setLinkOpen(false)
    setAlignOpen(false)
    setStyleFor(null)
    setShapePickerFor(null)
    setTagsFor(null)
  }
  const first = chosen[0]
  // the drag was record: false, letting go makes it one undo step
  const commitSlider = (): void => setItems(items)

  return (
    <div ref={floatingRef} data-wall-ui style={{
      position: 'absolute',
      left: `${floatingPos.left}px`, top: `${floatingPos.top}px`,
      transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: '2px',
      padding: '3px',
      background: 'var(--color-surface-elevated)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)',
      zIndex: 15
    }}>
      {/* a text box's colour is its letters', so it's an A as in a document; anything else's is its paper, one swatch with the palette a click in */}
      {textOnly ? (
        <ColorA
          value={agreed(chosen.map(i => i.color))}
          fallback="var(--color-text-base)"
          // live while the custom picker is dragged, one undo step when it is let go
          onPick={(c, final) => setItems(restyleBoxes(items, selectedIds, { color: c ?? undefined }, 'color'), { record: final })}
        />
      ) : (
        <div data-wall-swatch className="relative">
          <button
            onClick={() => { const open = swatchOpen; closeOthers(); setSwatchOpen(!open) }}
            title="Colour"
            aria-label="Colour"
            aria-expanded={swatchOpen}
            className="btn-icon"
            style={{
              width: '30px', height: '30px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: swatchOpen ? 'var(--color-surface-offset)' : undefined
            }}
          >
            <span
              aria-hidden
              style={{
                width: '16px', height: '16px', borderRadius: '50%',
                background: single?.color ?? 'transparent',
                // empty ring for none or mixed
                border: single?.color
                  ? '1px solid rgba(0, 0, 0, 0.25)'
                  : '1px dashed var(--color-text-faint)'
              }}
            />
          </button>
  
          {swatchOpen && (
            <div style={{ ...popover, padding: 'var(--space-2)', width: '146px' }}>
              <WallColorPicker
                colors={WALL_COLORS}
                value={single?.color}
                // live while the custom picker is dragged, one undo step when it is let go
                onChange={c => setItems(restyleBoxes(items, selectedIds, { color: c }, 'color'), { record: false })}
                onCommit={c => {
                  setItems(restyleBoxes(items, selectedIds, { color: c }, 'color'))
                  if (chosen.some(i => i.kind === 'note')) onStickyColor?.(c)
                }}
                onDone={() => setSwatchOpen(false)}
                columns={4}
              />
            </div>
          )}
        </div>
      )}
      <div style={{ width: '1px', height: '16px', background: 'var(--color-surface-offset)', margin: '0 2px' }} />
      {/* one item, one link; locked items keep theirs like their text */}
      {single && isLinkable(single.kind) && (
        <div className="relative">
          {toolButton(
            single.link ? 'Edit link' : 'Add a link',
            <Link2 size={13} />,
            () => { const open = linkOpen; closeOthers(); setLinkOpen(!open) },
            { active: linkOpen, disabled: single.locked }
          )}
          {linkOpen && !single.locked && (
            <div style={{ ...popover, padding: 'var(--space-3)', width: '300px' }}>
              <WallLinkEditor
                key={single.id}
                link={single.link}
                label={linkLabel}
                onSave={link => setItemLink(single.id, link)}
                onRemove={() => setItemLink(single.id, undefined)}
                onPick={() => startLinkPick(single.id)}
                onOpen={followLink}
                onClose={() => setLinkOpen(false)}
              />
            </div>
          )}
        </div>
      )}
      {arrowsSelected && arrowStyleButtons(
        single?.arrowShape ?? ARROW_SHAPES[0],
        single?.arrowLine ?? ARROW_LINES[0],
        single?.arrowHeads ?? ARROW_HEAD_MODES[0],
        v => setItems(patchItems(items, selectedIds, { arrowShape: v })),
        v => setItems(patchItems(items, selectedIds, { arrowLine: v })),
        v => setItems(patchItems(items, selectedIds, { arrowHeads: v }))
      )}
      {wordsSelected && textAlignButton(
        textAlignOf(first),
        v => setItems(patchItems(items, selectedIds, { align: v }))
      )}
      {/* a font by its name and a size to step or type, the way a document has them */}
      {wordsSelected && (
        <FontSelect
          value={agreed(chosen.map(i => i.font ?? 'sans')) ?? null}
          onPick={v => setItems(restyleBoxes(items, selectedIds, { font: v }, 'font'))}
        />
      )}
      {wordsSelected && first && (
        <SizeStepper
          value={agreed(chosen.map(fontSizeOf)) ?? null}
          stepFrom={fontSizeOf(first)}
          fit={{ active: chosen.every(i => i.fontSize === undefined) }}
          onPick={size => {
            setItems(items.map(i => {
              if (!selectedIds.has(i.id) || i.locked) return i
              const next = { ...i }
              if (size === undefined) delete next.fontSize
              else next.fontSize = size
              return next
            }))
          }}
        />
      )}
      {stickiesSelected && (
        <div className="relative" data-wall-popover="tags">
          {toolButton(
            'Tags',
            <Tags size={13} />,
            () => { const open = tagsOpen; closeOthers(); setTagsFor(open ? null : selectedIds) },
            { active: tagsOpen }
          )}
          {tagsOpen && (
            <div style={{ ...popover, padding: 'var(--space-3)', width: '220px' }}>
              <WallTagEditor
                tags={tagsOn(items, selectedIds)}
                known={tagNames}
                colors={tagColors}
                onAdd={onAddTag}
                onRemove={onRemoveTag}
                onGather={onGatherTags}
              />
            </div>
          )}
        </div>
      )}
      {codeSelected && (
        <select
          aria-label="Code language"
          title="Code language"
          value={first?.language ?? ''}
          onChange={e => setItems(patchItems(items, selectedIds, { language: e.target.value || undefined }))}
          style={{
            height: '26px', maxWidth: '140px',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-base)', fontSize: 'var(--text-xs)'
          }}
        >
          <option value="">Plain text</option>
          {CODE_LANGUAGES.map(language => (
            <option key={language.id} value={language.id}>{language.label}</option>
          ))}
        </select>
      )}
      {shapesSelected && (
        <div className="relative">
          {toolButton(
            'Shape',
            shapeGlyph(single?.shape ?? SHAPE_TYPES[0]),
            () => { const open = shapePickerOpen; closeOthers(); setShapePickerFor(open ? null : selectedIds) },
            { active: shapePickerOpen }
          )}
          {shapePickerOpen && (
            <div style={{ ...popover, top: 'calc(100% + 4px)', left: 0 }}>
              <ShapePickerMenu
                current={single?.shape ?? SHAPE_TYPES[0]}
                onPick={v => {
                  setItems(patchItems(items, selectedIds, { shape: v }))
                  setShapePickerFor(null)
                }}
                onClose={() => setShapePickerFor(null)}
              />
            </div>
          )}
        </div>
      )}
      {shapesSelected && (
        <div className="relative">
          {toolButton(
            'Shape style',
            <SlidersHorizontal size={13} />,
            () => { const open = styleOpen; closeOthers(); setStyleFor(open ? null : selectedIds) },
            { active: styleOpen }
          )}
          {styleOpen && (
            <div style={{ ...popover, padding: 'var(--space-3)', width: '160px', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div role="group" aria-label="Border" style={fieldLabel}>
                Border
                <WallColorPicker
                  colors={WALL_COLORS}
                  value={first.borderColor}
                  onChange={c => setItems(patchItems(items, selectedIds, { borderColor: c }), { record: false })}
                  onCommit={c => setItems(patchItems(items, selectedIds, { borderColor: c }))}
                  defaultLabel="Default"
                  onDefault={() => setItems(patchItems(items, selectedIds, { borderColor: undefined }))}
                  columns={4}
                />
              </div>
              {roundedSelected && (
                <label style={fieldLabel}>
                  Corners
                  <input
                    type="range"
                    aria-label="Corner radius"
                    min={0}
                    max={60}
                    value={first.radius ?? 16}
                    onChange={e => setItems(patchItems(items, selectedIds, { radius: Number(e.target.value) }), { record: false })}
                    onPointerUp={commitSlider}
                    onKeyUp={commitSlider}
                  />
                </label>
              )}
              <label style={fieldLabel}>
                Fill
                <input
                  type="range"
                  aria-label="Fill opacity"
                  min={10}
                  max={100}
                  step={5}
                  value={Math.round((first.opacity ?? 1) * 100)}
                  onChange={e => setItems(patchItems(items, selectedIds, { opacity: Number(e.target.value) / 100 }), { record: false })}
                  onPointerUp={commitSlider}
                  onKeyUp={commitSlider}
                />
              </label>
            </div>
          )}
        </div>
      )}
      {/* a picture: keep part of it, and put an upright photo the right way up */}
      {single && single.kind === 'image' && !single.locked && (
        toolButton('Crop this picture', <Crop size={13} />, () => onCropImage(single.id))
      )}
      {single && single.kind !== 'arrow' && !single.locked && (
        toolButton('Rotate a quarter turn', <RotateCw size={13} />, () => onTurn(90))
      )}
      {arrowsSelected && single && toolButton(
        single.text ? 'Edit label' : 'Add a label',
        <Type size={13} />,
        () => setEditingId(single.id)
      )}
      {arrowsSelected && (
        <div style={{ width: '1px', height: '16px', background: 'var(--color-surface-offset)', margin: '0 2px' }} />
      )}
      {/* stays open between clicks, lining up then spacing out is one job */}
      {pieces >= 2 && (
        <div className="relative">
          {toolButton(
            'Align',
            <AlignStartVertical size={13} />,
            () => { const open = alignOpen; closeOthers(); setAlignOpen(!open) },
            { active: alignOpen }
          )}
          {alignOpen && (
            <div style={{ ...popover, padding: '3px', display: 'grid', gridTemplateColumns: 'repeat(3, 30px)', gap: '2px' }}>
              {ALIGN.map(({ edge, label, icon }) => toolButton(label, icon, () => setItems(alignItems(items, selectedIds, edge))))}
              {toolButton(
                'Distribute horizontally',
                <AlignHorizontalDistributeCenter size={13} />,
                () => setItems(distributeItems(items, selectedIds, 'horizontal')),
                { disabled: pieces < 3 }
              )}
              {toolButton(
                'Distribute vertically',
                <AlignVerticalDistributeCenter size={13} />,
                () => setItems(distributeItems(items, selectedIds, 'vertical')),
                { disabled: pieces < 3 }
              )}
            </div>
          )}
        </div>
      )}
      {canGroup && toolButton('Group', <Group size={13} />, () => setItems(groupItems(items, selectedIds)))}
      {canUngroup && toolButton('Ungroup', <Ungroup size={13} />, () => setItems(ungroupItems(items, selectedIds)))}
      {toolButton('Bring to front', <ArrowUp size={13} />, () => single && setItems(bringToFront(items, single.id)), { disabled: !single })}
      {toolButton('Send to back', <ArrowDown size={13} />, () => single && setItems(sendToBack(items, single.id)), { disabled: !single })}
      {toolButton('Duplicate', <Copy size={13} />, duplicateSelected)}
      {toolButton(single?.locked ? 'Unlock' : 'Lock', single?.locked ? <Unlock size={13} /> : <Lock size={13} />, toggleLock)}
      {toolButton('Delete', <Trash2 size={13} />, removeSelected)}
    </div>
  )
}
