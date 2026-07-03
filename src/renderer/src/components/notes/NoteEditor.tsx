import React, { useRef, useState, useLayoutEffect, useCallback, useMemo, useEffect } from 'react'
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2,
  Quote, List, ListChecks, Link, Link2, Table, GitBranch, Minus
} from 'lucide-react'
import { applyFormat, countWords, readingTime, type FormatAction } from './notesUtils'

interface NoteEditorProps {
  content: string
  onChange: (value: string) => void
  /** All existing note titles, used for [[wiki-link]] autocomplete. */
  noteTitles: string[]
}

interface ToolbarButton {
  action: FormatAction
  icon: React.ReactNode
  label: string
}

const TOOLBAR_GROUPS: ToolbarButton[][] = [
  [
    { action: 'bold', icon: <Bold size={14} />, label: 'Bold  (Ctrl+B)' },
    { action: 'italic', icon: <Italic size={14} />, label: 'Italic  (Ctrl+I)' },
    { action: 'strike', icon: <Strikethrough size={14} />, label: 'Strikethrough' },
    { action: 'code', icon: <Code size={14} />, label: 'Inline code' }
  ],
  [
    { action: 'h1', icon: <Heading1 size={14} />, label: 'Heading 1' },
    { action: 'h2', icon: <Heading2 size={14} />, label: 'Heading 2' },
    { action: 'quote', icon: <Quote size={14} />, label: 'Quote' },
    { action: 'ul', icon: <List size={14} />, label: 'Bulleted list' },
    { action: 'checkbox', icon: <ListChecks size={14} />, label: 'Checklist' }
  ],
  [
    { action: 'link', icon: <Link size={14} />, label: 'Link  (Ctrl+K)' },
    { action: 'wikilink', icon: <Link2 size={14} />, label: 'Wiki link  [[ ]]' },
    { action: 'table', icon: <Table size={14} />, label: 'Table' },
    { action: 'mermaid', icon: <GitBranch size={14} />, label: 'Mermaid diagram' },
    { action: 'hr', icon: <Minus size={14} />, label: 'Divider' }
  ]
]

// Caret pixel-coordinate helper (mirror-div technique)
const MIRROR_PROPS: string[] = [
  'box-sizing', 'width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
  'line-height', 'text-transform', 'word-spacing', 'white-space', 'word-wrap'
]

function getCaretCoordinates(el: HTMLTextAreaElement, position: number): { top: number; left: number } {
  try {
    const div = document.createElement('div')
    const style = window.getComputedStyle(el)
    div.style.position = 'absolute'
    div.style.visibility = 'hidden'
    div.style.whiteSpace = 'pre-wrap'
    div.style.wordWrap = 'break-word'
    for (const prop of MIRROR_PROPS) {
      div.style.setProperty(prop, style.getPropertyValue(prop))
    }
    div.textContent = el.value.slice(0, position)
    const span = document.createElement('span')
    span.textContent = el.value.slice(position) || '.'
    div.appendChild(span)
    document.body.appendChild(div)
    const top = span.offsetTop - el.scrollTop
    const left = span.offsetLeft
    document.body.removeChild(div)
    return { top, left }
  } catch {
    return { top: 0, left: 0 }
  }
}

export default function NoteEditor({ content, onChange, noteTitles }: NoteEditorProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)

  // Wiki-link autocomplete state
  const [autocomplete, setAutocomplete] = useState<{
    query: string
    start: number // index just after `[[`
    top: number
    left: number
    index: number
  } | null>(null)

  const wordCount = useMemo(() => countWords(content), [content])
  const readTime = useMemo(() => readingTime(content), [content])

  // Restore selection after a programmatic value change (formatting actions).
  useLayoutEffect(() => {
    if (pendingSelection.current && textareaRef.current) {
      const { start, end } = pendingSelection.current
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(start, end)
      pendingSelection.current = null
    }
  }, [content])

  const runFormat = useCallback((action: FormatAction) => {
    const el = textareaRef.current
    if (!el) return
    const result = applyFormat(action, el.value, el.selectionStart, el.selectionEnd)
    pendingSelection.current = { start: result.selStart, end: result.selEnd }
    onChange(result.value)
  }, [onChange])

  // Autocomplete detection
  const suggestions = useMemo(() => {
    if (!autocomplete) return []
    const q = autocomplete.query.toLowerCase()
    return noteTitles
      .filter(t => t.toLowerCase().includes(q))
      .slice(0, 6)
  }, [autocomplete, noteTitles])

  const detectAutocomplete = useCallback((el: HTMLTextAreaElement) => {
    const caret = el.selectionStart
    if (caret !== el.selectionEnd) {
      setAutocomplete(null)
      return
    }
    const before = el.value.slice(0, caret)
    const open = before.lastIndexOf('[[')
    if (open === -1) {
      setAutocomplete(null)
      return
    }
    const between = before.slice(open + 2)
    // Cancel if the bracket was already closed or spans lines / contains a pipe target close
    if (between.includes(']]') || between.includes('\n') || between.includes('[[')) {
      setAutocomplete(null)
      return
    }
    const coords = getCaretCoordinates(el, open + 2)
    setAutocomplete({
      query: between,
      start: open + 2,
      top: coords.top + 20,
      left: coords.left,
      index: 0
    })
  }, [])

  const acceptSuggestion = useCallback((title: string) => {
    const el = textareaRef.current
    if (!el || !autocomplete) return
    const caret = el.selectionStart
    const before = el.value.slice(0, autocomplete.start)
    const after = el.value.slice(caret)
    // Insert the title and the closing ]] (add closing only if not already there)
    const closing = after.startsWith(']]') ? '' : ']]'
    const newValue = before + title + closing + after
    const newCaret = before.length + title.length + closing.length
    pendingSelection.current = { start: newCaret, end: newCaret }
    setAutocomplete(null)
    onChange(newValue)
  }, [autocomplete, onChange])

  // Re-detect autocomplete whenever content changes while typing.
  useEffect(() => {
    if (textareaRef.current && document.activeElement === textareaRef.current) {
      detectAutocomplete(textareaRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Autocomplete navigation
    if (autocomplete && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAutocomplete({ ...autocomplete, index: (autocomplete.index + 1) % suggestions.length })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAutocomplete({ ...autocomplete, index: (autocomplete.index - 1 + suggestions.length) % suggestions.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptSuggestion(suggestions[autocomplete.index])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAutocomplete(null)
        return
      }
    }

    // Formatting shortcuts
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase()
      if (k === 'b') { e.preventDefault(); runFormat('bold'); return }
      if (k === 'i') { e.preventDefault(); runFormat('italic'); return }
      if (k === 'k') { e.preventDefault(); runFormat('link'); return }
    }

    // Tab / Shift+Tab → indent / outdent (2 spaces)
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart, selectionEnd, value } = el
      if (!e.shiftKey && selectionStart === selectionEnd) {
        const newValue = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd)
        pendingSelection.current = { start: selectionStart + 2, end: selectionStart + 2 }
        onChange(newValue)
      } else {
        // Indent/outdent selected lines
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
        const block = value.slice(lineStart, selectionEnd)
        const updated = e.shiftKey
          ? block.split('\n').map(l => l.replace(/^ {1,2}/, '')).join('\n')
          : block.split('\n').map(l => '  ' + l).join('\n')
        const newValue = value.slice(0, lineStart) + updated + value.slice(selectionEnd)
        pendingSelection.current = { start: lineStart, end: lineStart + updated.length }
        onChange(newValue)
      }
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* Formatting toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: '6px var(--space-3)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)',
        flexWrap: 'wrap',
        flexShrink: 0
      }}>
        {TOOLBAR_GROUPS.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)' }} />}
            <div style={{ display: 'flex', gap: '2px' }}>
              {group.map(btn => (
                <button
                  key={btn.action}
                  className="note-tool-btn"
                  title={btn.label}
                  aria-label={btn.label}
                  onMouseDown={e => e.preventDefault() /* keep textarea selection */}
                  onClick={() => runFormat(btn.action)}
                >
                  {btn.icon}
                </button>
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        className="notes-textarea"
        value={content}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onClick={() => textareaRef.current && detectAutocomplete(textareaRef.current)}
        onBlur={() => setTimeout(() => setAutocomplete(null), 150)}
        placeholder="Type in markdown…  Use #tags to organize or [[Wiki Links]] to connect notes."
        spellCheck={false}
      />

      {/* Wiki-link autocomplete */}
      {autocomplete && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: `${autocomplete.top + 44}px`,
            left: `${Math.max(8, autocomplete.left)}px`,
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 50,
            minWidth: '200px',
            maxWidth: '280px',
            overflow: 'hidden'
          }}
        >
          <div style={{ padding: '4px 10px', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-faint)', fontWeight: 'var(--weight-bold)', borderBottom: '1px solid var(--color-surface-offset)' }}>
            Link to note
          </div>
          {suggestions.map((title, i) => (
            <button
              key={title}
              onMouseDown={e => { e.preventDefault(); acceptSuggestion(title) }}
              onMouseEnter={() => setAutocomplete(a => a ? { ...a, index: i } : a)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: i === autocomplete.index ? 'var(--color-primary-muted)' : 'transparent',
                border: 'none',
                color: 'var(--color-text-base)',
                fontSize: 'var(--text-xs)',
                padding: '6px 10px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {title}
            </button>
          ))}
        </div>
      )}

      {/* Stats footer */}
      <div style={{
        padding: '6px var(--space-4)',
        background: 'var(--color-surface-1)',
        borderTop: '1px solid var(--color-surface-offset)',
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '12px',
        fontSize: '10px',
        color: 'var(--color-text-faint)',
        userSelect: 'none',
        flexShrink: 0
      }}>
        <span>{content.length} chars</span>
        <span>{wordCount} words</span>
        <span>{readTime}</span>
      </div>
    </div>
  )
}
