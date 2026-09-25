import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { continueList, hasWrap, indentLines, takesIndent, toggleWrap } from '../../../../shared/wallText'

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

function FormatButton({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-wall-ui
      title={label}
      aria-label={label}
      aria-pressed={active}
      onPointerDown={e => {
        e.stopPropagation()
      }}
      onMouseDown={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className="btn-icon"
      style={{
        width: '28px',
        height: '28px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--color-primary)' : 'transparent',
        color: active ? '#ffffff' : 'var(--color-text-base)',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.15s ease, color 0.15s ease'
      }}
    >
      {children}
    </button>
  )
}

/** a plain textarea with list-aware Enter, Tab indents and formatting keys */
export default function WallTextEditor({ value, onChange, onFinish, style, onHeight, onNext, code, onChild, onSibling }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  /** set once the new value has rendered, or React leaves the caret at the end */
  const pendingSelection = useRef<[number, number] | null>(null)
  const [selection, setSelection] = useState<[number, number] | null>(null)

  const updateSelection = (): void => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start !== end) {
      setSelection([start, end])
    } else {
      setSelection(null)
    }
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const sel = pendingSelection.current
    if (sel) {
      pendingSelection.current = null
      el.setSelectionRange(sel[0], sel[1])
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
    if (edit.start !== edit.end) {
      setSelection([edit.start, edit.end])
    } else {
      setSelection(null)
    }
    const el = ref.current
    if (el) {
      el.focus()
      requestAnimationFrame(() => {
        if (ref.current) {
          ref.current.focus()
          ref.current.setSelectionRange(edit.start, edit.end)
        }
      })
    }
  }

  const toggleMarker = (marker: string): void => {
    const el = ref.current
    if (!el) return
    const selStart = el.selectionStart
    const selEnd = el.selectionEnd
    const [start, end] = (selStart !== selEnd) ? [selStart, selEnd] : (selection ?? [0, 0])
    if (start === end) return
    const edit = toggleWrap(el.value, start, end, marker)
    apply(edit)
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
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {!code && selection && selection[0] !== selection[1] && (
        <div
          data-wall-ui
          role="toolbar"
          aria-label="Format selected text"
          onPointerDown={e => {
            e.stopPropagation()
          }}
          onMouseDown={e => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            padding: '3px 4px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 60,
            whiteSpace: 'nowrap'
          }}
        >
          <FormatButton
            label="Bold (Ctrl+B)"
            active={hasWrap(value, selection[0], selection[1], '**')}
            onClick={() => toggleMarker('**')}
          >
            <strong style={{ fontSize: '13px', fontWeight: 800 }}>B</strong>
          </FormatButton>

          <FormatButton
            label="Italic (Ctrl+I)"
            active={hasWrap(value, selection[0], selection[1], '_')}
            onClick={() => toggleMarker('_')}
          >
            <em style={{ fontSize: '13px', fontStyle: 'italic', fontFamily: 'serif' }}>I</em>
          </FormatButton>

          <FormatButton
            label="Underline (Ctrl+U)"
            active={hasWrap(value, selection[0], selection[1], '++')}
            onClick={() => toggleMarker('++')}
          >
            <u style={{ fontSize: '13px', textDecorationThickness: '1.8px', textUnderlineOffset: '2px' }}>U</u>
          </FormatButton>

          <FormatButton
            label="Strikethrough (Ctrl+Shift+X)"
            active={hasWrap(value, selection[0], selection[1], '~~')}
            onClick={() => toggleMarker('~~')}
          >
            <s style={{ fontSize: '13px', textDecorationThickness: '1.8px' }}>S</s>
          </FormatButton>

          <FormatButton
            label="Code (Ctrl+E)"
            active={hasWrap(value, selection[0], selection[1], '`')}
            onClick={() => toggleMarker('`')}
          >
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>&lt;/&gt;</span>
          </FormatButton>
        </div>
      )}
      <textarea
        ref={ref}
        autoFocus
        value={value}
        onChange={e => {
          onChange(e.target.value)
          updateSelection()
        }}
        onSelect={updateSelection}
        onMouseUp={updateSelection}
        onKeyUp={updateSelection}
        onBlur={onFinish}
        onKeyDown={onKeyDown}
        spellCheck={code ? false : undefined}
        wrap={code ? 'off' : undefined}
        style={style}
      />
    </div>
  )
}
