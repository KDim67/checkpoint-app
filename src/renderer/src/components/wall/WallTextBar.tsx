/** the bar above a box while it's written in: everything on it changes the words selected, or what's typed next */

import React, { useEffect, useRef, useState } from 'react'
import {
  $getSelection, $isElementNode, $isRangeSelection, $isTextNode, FORMAT_ELEMENT_COMMAND, FORMAT_TEXT_COMMAND,
  type LexicalNode, type TextFormatType
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $patchStyleText } from '@lexical/selection'
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { $findMatchingParent } from '@lexical/utils'
import { Link2 } from 'lucide-react'
import type { TextAlign, WallFont } from '../../../../shared/wallModel'
import { FONT_KEY, readStyle } from './richLines'
import { fontCssFamily } from './wallButtons'
import { AlignButtons, ColorA, FontSelect, SizeStepper, StyleToggle, ToolbarDivider } from './wallTextControls'

interface BarState {
  formats: Record<'bold' | 'italic' | 'underline' | 'strikethrough' | 'code', boolean>
  /** undefined: the box's own; null: the words differ */
  color: string | null | undefined
  /** a multiple of the box's size; undefined: the box's own; null: the words differ */
  size: number | null | undefined
  font: WallFont | null
  align: TextAlign | null
  link: string | null
  collapsed: boolean
}

const EMPTY: BarState = {
  formats: { bold: false, italic: false, underline: false, strikethrough: false, code: false },
  color: undefined, size: undefined, font: 'sans', align: null, link: null, collapsed: true
}

/** one value when every word agrees, null when they don't */
function agreed<T>(values: T[]): T | null | undefined {
  if (values.length === 0) return undefined
  return values.every(v => v === values[0]) ? values[0] : null
}

function $readBar(boxAlign: TextAlign): BarState {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return EMPTY
  const anchor = selection.anchor.getNode()
  // a caret reads what's typed next: the style waiting on the selection, or the word it sits in
  const styles = selection.isCollapsed()
    ? [readStyle(selection.style || ($isTextNode(anchor) ? anchor.getStyle() : ''))]
    : selection.getNodes().filter($isTextNode).map(node => readStyle(node.getStyle()))
  const lines = [...new Set(selection.getNodes().map(n => n.getTopLevelElementOrThrow()))].filter($isElementNode)
  const link = $findMatchingParent(anchor as LexicalNode, $isLinkNode)
  return {
    formats: {
      bold: selection.hasFormat('bold'),
      italic: selection.hasFormat('italic'),
      underline: selection.hasFormat('underline'),
      strikethrough: selection.hasFormat('strikethrough'),
      code: selection.hasFormat('code')
    },
    color: agreed(styles.map(s => s.color)),
    size: agreed(styles.map(s => s.size)),
    font: agreed(styles.map(s => s.font ?? 'sans')) ?? 'sans',
    align: agreed(lines.map(line => {
      const type = line.getFormatType()
      return type === 'left' || type === 'center' || type === 'right' ? type : boxAlign
    })) ?? null,
    link: link && $isLinkNode(link) ? link.getURL() : null,
    collapsed: selection.isCollapsed()
  }
}

function LinkButton({ current, disabled, onApply, onDone }: {
  current: string | null
  disabled: boolean
  onApply: (url: string | null) => void
  onDone: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(current ?? '')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setDraft(current ?? ''), [current, open])
  const valid = /^(https?:\/\/|mailto:)\S+$/i.test(draft.trim())
  const close = (): void => {
    setOpen(false)
    onDone()
  }
  return (
    <div ref={ref} className="wall-tb-anchor">
      <StyleToggle label={current ? 'Edit link' : 'Link'} active={current !== null} disabled={disabled} onToggle={() => setOpen(!open)}>
        <Link2 size={14} aria-hidden="true" />
      </StyleToggle>
      {open && (
        <form
          className="wall-tb-popover wall-tb-popover-padded wall-tb-link"
          data-wall-ui
          onPointerDown={e => e.stopPropagation()}
          onSubmit={e => {
            e.preventDefault()
            if (!valid) return
            onApply(draft.trim())
            close()
          }}
        >
          <input
            autoFocus
            className="input-xs"
            aria-label="Link address"
            placeholder="https://"
            value={draft}
            spellCheck={false}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') close() }}
          />
          <button type="submit" className="btn-primary" disabled={!valid}>Apply</button>
          {current && (
            <button type="button" className="btn-ghost" onClick={() => { onApply(null); close() }}>Remove</button>
          )}
        </form>
      )}
    </div>
  )
}

export default function WallTextBar({ boxSize, boxAlign, textColor }: {
  /** the box's own size in pixels, which a word's size is a multiple of */
  boxSize: number
  boxAlign: TextAlign
  /** what an uncoloured word shows in */
  textColor: string
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [state, setState] = useState<BarState>(EMPTY)

  useEffect(() => {
    const read = (): void => setState(editor.getEditorState().read(() => $readBar(boxAlign)))
    read()
    return editor.registerUpdateListener(read)
  }, [editor, boxAlign])

  const refocus = (): void => editor.focus()
  const patch = (style: Record<string, string | null>): void => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) $patchStyleText(selection, style)
    })
  }
  const format = (kind: TextFormatType): void => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, kind)
  }
  const sizePx = state.size === null ? null : Math.round((state.size ?? 1) * boxSize)

  return (
    <div className="wall-tb" data-wall-ui role="toolbar" aria-label="Format text" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <FontSelect
        value={state.font}
        onPick={font => patch(font === 'sans' ? { 'font-family': null, [FONT_KEY]: null } : { 'font-family': fontCssFamily(font), [FONT_KEY]: font })}
        onDone={refocus}
      />
      <SizeStepper
        value={sizePx}
        stepFrom={boxSize}
        onPick={px => {
          // kept as a multiple of the box's size; the box's own size is no size of its own
          const multiple = px === undefined ? 1 : Math.min(8, Math.max(0.25, Number((px / boxSize).toFixed(2))))
          patch({ 'font-size': multiple === 1 ? null : `${multiple}em` })
        }}
        onDone={refocus}
      />
      <ToolbarDivider />
      <StyleToggle label="Bold (Ctrl+B)" active={state.formats.bold} onToggle={() => format('bold')}><strong className="wall-tb-glyph">B</strong></StyleToggle>
      <StyleToggle label="Italic (Ctrl+I)" active={state.formats.italic} onToggle={() => format('italic')}><em className="wall-tb-glyph wall-tb-glyph-italic">I</em></StyleToggle>
      <StyleToggle label="Underline (Ctrl+U)" active={state.formats.underline} onToggle={() => format('underline')}><u className="wall-tb-glyph">U</u></StyleToggle>
      <StyleToggle label="Strikethrough (Ctrl+Shift+X)" active={state.formats.strikethrough} onToggle={() => format('strikethrough')}><s className="wall-tb-glyph">S</s></StyleToggle>
      <StyleToggle label="Code (Ctrl+E)" active={state.formats.code} onToggle={() => format('code')}><span className="wall-tb-glyph wall-tb-glyph-code">&lt;/&gt;</span></StyleToggle>
      <ColorA value={state.color} fallback={textColor} onPick={color => patch({ color })} onDone={refocus} />
      <LinkButton
        current={state.link}
        disabled={state.collapsed && state.link === null}
        onApply={url => editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)}
        onDone={refocus}
      />
      <ToolbarDivider />
      <AlignButtons
        value={state.align}
        // the box's own alignment is no alignment of its own, so a line set back to it follows the box again
        onPick={side => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, side === boxAlign ? '' : side)}
      />
    </div>
  )
}
