import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { continueList, indentLines, takesIndent, toggleWrap } from '../../../../shared/wallText'

interface Props {
  value: string
  onChange: (value: string) => void
  onFinish: () => void
  style?: CSSProperties
  /** the words' height, so a text box can grow with them */
  onHeight?: (height: number) => void
  /** Tab outside a list, the next item beside this one or below it */
  onNext?: (side: 'right' | 'bottom') => void
  /** source code: no formatting keys or lists, Tab indents and a new line keeps the indent */
  code?: boolean
  /** a mind map topic: Tab adds one under it and Enter one beside it, Shift+Enter still breaks the line */
  onChild?: () => void
  onSibling?: () => void
}

// under ctrl or cmd; strikethrough takes shift too
const MARKERS: Record<string, string> = { b: '**', i: '_', e: '`', u: '++' }

/** a plain textarea with list-aware Enter, Tab indents and formatting keys */
export default function WallTextEditor({ value, onChange, onFinish, style, onHeight, onNext, code, onChild, onSibling }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  /** set once the new value has rendered, or React leaves the caret at the end */
  const pendingSelection = useRef<[number, number] | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const selection = pendingSelection.current
    if (selection) {
      pendingSelection.current = null
      el.setSelectionRange(selection[0], selection[1])
    }

    if (onHeight) {
      // collapsed first, scrollHeight never reports less than the box it's in
      const previous = el.style.height
      el.style.height = '0px'
      onHeight(el.scrollHeight)
      el.style.height = previous
    }
  }, [value, onHeight])

  const apply = (edit: { value: string; start: number; end: number }): void => {
    pendingSelection.current = [edit.start, edit.end]
    onChange(edit.value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget
    const mod = e.ctrlKey || e.metaKey

    if (e.key === 'Escape' || (e.key === 'Enter' && mod)) {
      e.preventDefault()
      onFinish()
      return
    }

    const { selectionStart: start, selectionEnd: end } = el

    if (mod && !e.altKey && !code) {
      const key = e.key.toLowerCase()
      const marker = e.shiftKey ? (key === 'x' ? '~~' : undefined) : MARKERS[key]
      if (marker) {
        e.preventDefault()
        apply(toggleWrap(el.value, start, end, marker))
        return
      }
    }

    // Tab would leave the box; in a list or across lines it's a level, anywhere else the next item
    if (e.key === 'Tab') {
      e.preventDefault()
      if (onChild && !e.shiftKey && !mod) {
        onChild()
      } else if (code && start === end && !e.shiftKey) {
        apply({ value: `${el.value.slice(0, start)}  ${el.value.slice(end)}`, start: start + 2, end: start + 2 })
      } else if (onNext && !code && !mod && !el.value.slice(start, end).includes('\n') && !takesIndent(el.value, start)) {
        onNext(e.shiftKey ? 'bottom' : 'right')
      } else {
        apply(indentLines(el.value, start, end, e.shiftKey))
      }
      return
    }

    if (e.key === 'Enter' && !e.shiftKey && onSibling) {
      e.preventDefault()
      onSibling()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey && start === end && code) {
      // the new line starts as far in as this one
      const lineStart = el.value.lastIndexOf('\n', start - 1) + 1
      const indent = /^[ \t]*/.exec(el.value.slice(lineStart, start))?.[0] ?? ''
      e.preventDefault()
      apply({ value: `${el.value.slice(0, start)}\n${indent}${el.value.slice(end)}`, start: start + 1 + indent.length, end: start + 1 + indent.length })
      return
    }

    if (e.key === 'Enter' && !e.shiftKey && start === end) {
      const next = continueList(el.value, start)
      if (next) {
        e.preventDefault()
        apply({ value: next.value, start: next.caret, end: next.caret })
      }
    }
  }

  return (
    <textarea
      ref={ref}
      autoFocus
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onFinish}
      onKeyDown={onKeyDown}
      spellCheck={code ? false : undefined}
      wrap={code ? 'off' : undefined}
      style={style}
    />
  )
}
