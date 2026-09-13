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
}

// under ctrl or cmd; strikethrough takes shift too
const MARKERS: Record<string, string> = { b: '**', i: '_', e: '`' }

/** a plain textarea with list-aware Enter, Tab indents and formatting keys */
export default function WallTextEditor({ value, onChange, onFinish, style, onHeight, onNext }: Props) {
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

    if (mod && !e.altKey) {
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
      if (onNext && !mod && !el.value.slice(start, end).includes('\n') && !takesIndent(el.value, start)) {
        onNext(e.shiftKey ? 'bottom' : 'right')
      } else {
        apply(indentLines(el.value, start, end, e.shiftKey))
      }
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
      style={style}
    />
  )
}
