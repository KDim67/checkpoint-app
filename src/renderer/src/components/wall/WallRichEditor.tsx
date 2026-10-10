/** writing in a wall box: words show their formatting, colour, size and font as they're typed, and are kept as Wall text */

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type MutableRefObject } from 'react'
import {
  $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND, KEY_DOWN_COMMAND, KEY_ENTER_COMMAND, KEY_ESCAPE_COMMAND, KEY_TAB_COMMAND, PASTE_COMMAND,
  type ElementNode, type LexicalEditor, type RangeSelection
} from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { EditorRefPlugin } from '@lexical/react/LexicalEditorRefPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { LinkNode } from '@lexical/link'
import { $generateNodesFromDOM } from '@lexical/html'
import { $insertGeneratedNodes } from '@lexical/clipboard'
import { BOLD_STAR, INLINE_CODE, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH } from '@lexical/markdown'
import { listContinuation, parseWallLines, serializeWallLines, takesIndent } from '../../../../shared/wallText'
import type { TextAlign } from '../../../../shared/wallModel'
import { fitTextSize } from '../../lib/fitText'
import { $loadLines, $readLines } from './richLines'
import WallTextBar from './WallTextBar'

interface Props {
  value: string
  onChange: (value: string) => void
  onFinish: () => void
  style?: CSSProperties
  /** the words' height, so a text box can grow with them */
  onHeight?: (height: number) => void
  /** Tab outside a list, the next item beside this one or below it */
  onNext?: (side: 'right' | 'bottom') => void
  /** a mind map topic: Tab adds one under it and Enter one beside it, Shift+Enter still breaks the line */
  onChild?: () => void
  onSibling?: () => void
  /** the size the words read at; with a floor they shrink to fit the box as they are typed */
  fitBase?: number
  fitMin?: number
  /** they shrink no further and still overflow: the pixels the box is short by */
  onNeedRoom?: (extra: number) => void
  /** the box's own size and alignment, which a word's size is a multiple of and a line's alignment falls back to */
  boxSize: number
  boxAlign: TextAlign
  /** the editor itself, for tests */
  editorRef?: MutableRefObject<LexicalEditor | null>
}

// Lexical's own shortcuts for the markers Wall text already has
const SHORTCUTS = [BOLD_STAR, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH, INLINE_CODE]

const THEME = {
  paragraph: 'wall-rich-line',
  link: 'wall-text-link',
  text: {
    bold: 'wall-rich-bold',
    italic: 'wall-rich-italic',
    underline: 'wall-rich-underline',
    strikethrough: 'wall-rich-strike',
    underlineStrikethrough: 'wall-rich-underline-strike',
    code: 'wall-code'
  }
}

/** the top-level line the selection's end is in, and where in its words the caret sits */
function caretLine(selection: RangeSelection): { line: ElementNode; text: string; offset: number } {
  const anchor = selection.anchor
  const line = anchor.getNode().getTopLevelElementOrThrow()
  let offset = 0
  for (const node of line.getAllTextNodes()) {
    if (anchor.type === 'text' && node.is(anchor.getNode())) {
      offset += anchor.offset
      return { line, text: line.getTextContent(), offset }
    }
    offset += node.getTextContentSize()
  }
  return { line, text: line.getTextContent(), offset: anchor.type === 'element' && anchor.offset === 0 ? 0 : offset }
}

/** two spaces in or out at the start of a line, the way the wall indents */
function indentLine(line: ElementNode, outdent: boolean): void {
  const first = line.getAllTextNodes()[0]
  if (!outdent) {
    const spaces = $createTextNode('  ')
    const child = line.getFirstChild()
    if (child) child.insertBefore(spaces)
    else line.append(spaces)
    return
  }
  if (!first) return
  const removed = /^ {1,2}/.exec(first.getTextContent())?.[0].length ?? 0
  if (removed === 0) return
  if (removed === first.getTextContentSize()) {
    first.remove()
    return
  }
  first.spliceText(0, removed, '', false)
  // the caret moves back with the words it was among
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return
  for (const point of [selection.anchor, selection.focus]) {
    if (point.key === first.getKey()) point.set(point.key, Math.max(0, point.offset - removed), 'text')
  }
}

function KeysPlugin({ onFinish, onNext, onChild, onSibling }: Pick<Props, 'onFinish' | 'onNext' | 'onChild' | 'onSibling'>) {
  const [editor] = useLexicalComposerContext()
  const props = useRef({ onFinish, onNext, onChild, onSibling })
  props.current = { onFinish, onNext, onChild, onSibling }

  useEffect(() => {
    const removers = [
      editor.registerCommand(KEY_ESCAPE_COMMAND, () => {
        props.current.onFinish()
        return true
      }, COMMAND_PRIORITY_HIGH),

      editor.registerCommand(KEY_ENTER_COMMAND, event => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false
        if (event && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          props.current.onFinish()
          return true
        }
        if (event?.shiftKey) {
          // a line break is a new line here, as it is in the text kept
          event.preventDefault()
          selection.insertParagraph()
          return true
        }
        if (props.current.onSibling) {
          event?.preventDefault()
          props.current.onSibling()
          return true
        }
        if (!selection.isCollapsed()) return false
        const { line, text, offset } = caretLine(selection)
        const next = listContinuation(text, offset)
        if (next === null) return false
        event?.preventDefault()
        if (next === 'leave') {
          line.clear()
          line.select()
          return true
        }
        selection.insertParagraph()
        const after = $getSelection()
        if (!$isRangeSelection(after)) return true
        const fresh = after.anchor.getNode().getTopLevelElementOrThrow()
        // the marker is plain, whatever the words around it are wearing
        const marker = $createTextNode(next.prefix)
        const firstChild = fresh.getFirstChild()
        if (firstChild) firstChild.insertBefore(marker)
        else fresh.append(marker)
        marker.select(next.prefix.length, next.prefix.length)
        return true
      }, COMMAND_PRIORITY_HIGH),

      editor.registerCommand(KEY_TAB_COMMAND, event => {
        event.preventDefault()
        const { onChild: child, onNext: next } = props.current
        const mod = event.ctrlKey || event.metaKey
        if (child && !event.shiftKey && !mod) {
          child()
          return true
        }
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return true
        const lines = [...new Set(selection.getNodes().map(n => n.getTopLevelElementOrThrow()))].filter($isElementNode)
        const { text, offset } = caretLine(selection)
        if (next && !mod && lines.length <= 1 && !takesIndent(text, offset)) {
          next(event.shiftKey ? 'bottom' : 'right')
          return true
        }
        for (const line of lines) indentLine(line, event.shiftKey)
        return true
      }, COMMAND_PRIORITY_HIGH),

      // Ctrl+B, I and U come with the editor; code and strikethrough are the wall's own keys
      editor.registerCommand(KEY_DOWN_COMMAND, event => {
        const mod = event.ctrlKey || event.metaKey
        if (!mod || event.altKey) return false
        const key = event.key.toLowerCase()
        if (key === 'e' && !event.shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')
          return true
        }
        if (key === 'x' && event.shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')
          return true
        }
        return false
      }, COMMAND_PRIORITY_HIGH)
    ]
    return () => removers.forEach(remove => remove())
  }, [editor])
  return null
}

/** words pasted from elsewhere keep their bold, italics, underline, strikes, code and links, but not their colours, sizes or fonts */
function PastePlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => editor.registerCommand(PASTE_COMMAND, event => {
    const data = 'clipboardData' in event ? event.clipboardData : null
    // copied from another wall box, it is the wall's own formatting already
    if (!data || data.types.includes('application/x-lexical-editor')) return false
    const html = data.getData('text/html')
    if (!html) return false
    event.preventDefault()
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const nodes = $generateNodesFromDOM(editor, dom)
    const strip = (node: (typeof nodes)[number]): void => {
      if ($isTextNode(node)) node.setStyle('')
      else if ('getChildren' in node && typeof node.getChildren === 'function') (node.getChildren() as typeof nodes).forEach(strip)
    }
    nodes.forEach(strip)
    const selection = $getSelection()
    if ($isRangeSelection(selection)) $insertGeneratedNodes(editor, nodes, selection)
    return true
  }, COMMAND_PRIORITY_HIGH), [editor])
  return null
}

/** hands the text back as it is kept, only when the words changed; an old box opened and closed is left exactly as it was */
function EmitPlugin({ value, onChange }: Pick<Props, 'value' | 'onChange'>) {
  const [editor] = useLexicalComposerContext()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // what the original reads as once written the editor's way; reaching it again means nothing changed
  const original = useRef({ value, written: serializeWallLines(parseWallLines(value)) })
  const last = useRef(value)

  useEffect(() => editor.registerUpdateListener(({ editorState, prevEditorState, dirtyElements, dirtyLeaves }) => {
    if (prevEditorState.isEmpty() || (dirtyElements.size === 0 && dirtyLeaves.size === 0)) return
    const written = editorState.read(() => serializeWallLines($readLines()))
    const next = written === original.current.written ? original.current.value : written
    if (next === last.current) return
    last.current = next
    onChangeRef.current(next)
  }), [editor])
  return null
}

/** opened to write in, it picks up where the words end; focusing alone would leave the caret in front of the first one */
function FocusEndPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    const toEnd = (): void => editor.update(() => { $getRoot().selectEnd() })
    editor.focus(toEnd)
    // focusing reports the browser's own caret, at the start, a moment later; the end is set again after it
    const later = setTimeout(toEnd, 0)
    return () => clearTimeout(later)
  }, [editor])
  return null
}

/** grows the box with its words, or shrinks the words to the box, after every change */
function MeasurePlugin({ onHeight, fitBase, fitMin, onNeedRoom }: Pick<Props, 'onHeight' | 'fitBase' | 'fitMin' | 'onNeedRoom'>) {
  const [editor] = useLexicalComposerContext()
  const props = useRef({ onHeight, fitBase, fitMin, onNeedRoom })
  props.current = { onHeight, fitBase, fitMin, onNeedRoom }

  useLayoutEffect(() => {
    const measure = (): void => {
      const el = editor.getRootElement()
      if (!el) return
      const { onHeight: height, fitBase: base, fitMin: min, onNeedRoom: needRoom } = props.current
      if (height) {
        // collapsed first, scrollHeight never reports less than the box it's in
        const previous = el.style.height
        el.style.height = '0px'
        height(el.scrollHeight)
        el.style.height = previous
      }
      if (base) {
        const { over } = fitTextSize(el, base, min ?? base)
        if (over > 0) needRoom?.(over)
      }
    }
    measure()
    return editor.registerUpdateListener(measure)
  }, [editor])
  return null
}

export default function WallRichEditor({
  value, onChange, onFinish, style, onHeight, onNext, onChild, onSibling, fitBase, fitMin, onNeedRoom, boxSize, boxAlign, editorRef
}: Props) {
  const wrapper = useRef<HTMLDivElement>(null)
  const initialConfig = useRef({
    namespace: 'wall-text',
    nodes: [LinkNode],
    theme: THEME,
    onError: (error: Error) => console.error('[wall] The text editor failed:', error),
    editorState: () => {
      $loadLines(parseWallLines(value))
      if ($getRoot().getChildrenSize() === 0) $getRoot().append($createParagraphNode())
    }
  }).current

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div ref={wrapper} className="wall-rich-wrap">
        <WallTextBar boxSize={boxSize} boxAlign={boxAlign} textColor={String(style?.color ?? 'currentColor')} />
        <RichTextPlugin
          contentEditable={(
            <ContentEditable
              className="wall-rich-editor"
              aria-label="Text"
              spellCheck
              style={style}
              // a click on the text bar, or in one of its pickers, is still writing
              onBlur={event => {
                if (event.relatedTarget instanceof Node && wrapper.current?.contains(event.relatedTarget)) return
                onFinish()
              }}
            />
          )}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <LinkPlugin validateUrl={url => /^(https?:\/\/|mailto:)\S+$/i.test(url)} />
        <MarkdownShortcutPlugin transformers={SHORTCUTS} />
        <FocusEndPlugin />
        <KeysPlugin onFinish={onFinish} onNext={onNext} onChild={onChild} onSibling={onSibling} />
        <PastePlugin />
        <EmitPlugin value={value} onChange={onChange} />
        <MeasurePlugin onHeight={onHeight} fitBase={fitBase} fitMin={fitMin} onNeedRoom={onNeedRoom} />
        {editorRef && <EditorRefPlugin editorRef={editorRef} />}
      </div>
    </LexicalComposer>
  )
}
