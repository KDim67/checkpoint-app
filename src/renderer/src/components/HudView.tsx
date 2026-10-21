import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, Calendar, Flag, Hash, Loader2, NotebookPen, SquareCheck } from 'lucide-react'
import { formatDue } from '../../../shared/dueDate'
import type { Tag } from '../../../shared/types'
import type { WorkspaceEntry } from '../lib/createWorkspace'
import { readWorkspaceList } from '../lib/workspaceList'
import { getStringSetting } from '../lib/settings'
import { listTags, resolveTagIds } from '../data/tags'
import { createItem } from '../data/items'
import * as hudApi from '../data/hud'
import {
  PRIORITY_NAMES,
  hasTaskPrefix,
  matching,
  parseCapture,
  typingAt,
  withPick,
  withoutTaskPrefix,
  workspaceNamed,
  type CaptureKind
} from '../lib/quickCapture'

/** a tag first made here starts in the same quiet slate the tag editor offers first */
const NEW_TAG_COLOR = '#535e85'

const PRIORITY_COLORS = ['var(--color-text-muted)', 'var(--color-priority-low)', 'var(--color-priority-med)', 'var(--color-priority-high)']

type Suggestion =
  | { kind: 'workspace'; entry: WorkspaceEntry; current: boolean }
  | { kind: 'tag'; tag: Tag }

const playChime = () => {
  try {
    const audioCtx = new AudioContext()
    const osc = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()

    osc.connect(gainNode)
    gainNode.connect(audioCtx.destination)

    osc.type = 'sine'
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime) // D5
    osc.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.08) // A5

    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.32)

    osc.start()
    osc.stop(audioCtx.currentTime + 0.36)
  } catch (e) {
    console.error('Chime audio failure:', e)
  }
}

function Key({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <kbd className="hud-key">{children}</kbd>
}

export default function HudView() {
  const [value, setValue] = useState('')
  const [mode, setMode] = useState<CaptureKind>('log')
  const [caret, setCaret] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [activeSlug, setActiveSlug] = useState('default')
  const [tags, setTags] = useState<Tag[]>([])
  const [highlighted, setHighlighted] = useState(0)
  // Escape closes the list without closing the bar, until the next keystroke
  const [listClosed, setListClosed] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const parsed = parseCapture(value, mode)
  // the workspace you're in, as the main window last saved it
  const current: WorkspaceEntry = workspaces.find(entry => entry.slug === activeSlug)
    ?? workspaces[0]
    ?? { slug: activeSlug, name: activeSlug, color: 'var(--color-secondary)' }
  const named = parsed.workspace === null ? null : workspaceNamed(workspaces, parsed.workspace)
  const destination = parsed.workspace === null ? current : named

  const typing = listClosed ? null : typingAt(value, caret)
  const suggestions: Suggestion[] = !typing ? [] : typing.marker === '@'
    ? matching(workspaces, typing.query, entry => [entry.slug, entry.name]).map(entry => ({ kind: 'workspace', entry, current: entry.slug === current.slug }))
    : matching(tags, typing.query, tag => [tag.name]).map(tag => ({ kind: 'tag', tag }))
  const listOpen = suggestions.length > 0
  const shown = Math.min(highlighted, Math.max(0, suggestions.length - 1))

  // the list of workspaces, the one you're in and your tags, read again each time the bar opens
  const refresh = useCallback(() => {
    void readWorkspaceList().then(setWorkspaces)
    void getStringSetting('active_context', 'default').then(slug => setActiveSlug(slug || 'default'))
    void listTags().then(setTags).catch(err => console.error('Could not read the tags for suggestions:', err))
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  // main puts the bar away on blur, Escape or a save
  useEffect(() => hudApi.onReset(() => {
    setValue('')
    setMode('log')
    setCaret(0)
    setError(null)
    setListClosed(false)
    setHighlighted(0)
  }), [])

  // the window is as tall as what it shows: a hint line, a list, a preview or an error
  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const observer = new ResizeObserver(() => hudApi.resize(Math.ceil(shell.getBoundingClientRect().height)))
    observer.observe(shell)
    return () => observer.disconnect()
  }, [])

  const edit = (next: string, at: number): void => {
    setValue(next)
    setCaret(at)
    setError(null)
    setListClosed(false)
    setHighlighted(0)
  }

  const placeCaret = (at: number): void => {
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(at, at))
  }

  // Tab, or a click on the chip; "- " typed at the start counts as a task until switched back
  const switchKind = (): void => {
    if (hasTaskPrefix(value)) {
      const next = withoutTaskPrefix(value)
      edit(next, Math.max(0, caret - (value.length - next.length)))
      placeCaret(Math.max(0, caret - (value.length - next.length)))
      setMode('log')
    } else {
      setMode(kind => (kind === 'task' ? 'log' : 'task'))
    }
    inputRef.current?.focus()
  }

  const pick = (suggestion: Suggestion): void => {
    if (!typing) return
    const placed = withPick(value, typing, suggestion.kind === 'workspace' ? suggestion.entry.slug : suggestion.tag.name)
    edit(placed.text, placed.caret)
    placeCaret(placed.caret)
    inputRef.current?.focus()
  }

  const save = async (): Promise<void> => {
    if (submitting) return
    if (!parsed.title) {
      setError('Type something to save first.')
      return
    }
    if (!destination) {
      setError(`There's no workspace called "${parsed.workspace}". Pick one from the list, or leave out the @ to save to ${current.name}.`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const tagIds = await resolveTagIds(parsed.tags.map(name => ({ name: name.toLowerCase(), color: NEW_TAG_COLOR })))
      await createItem({
        type: parsed.kind,
        // the real slug, so @Work lands in "work" and not a workspace that doesn't exist
        context: destination.slug,
        title: parsed.title,
        body: '',
        status: 'open',
        priority: parsed.priority,
        position: Date.now(),
        due_at: parsed.dueAt,
        metadata: '{}'
      }, tagIds)
      playChime()
      await hudApi.hide()
    } catch (err) {
      setError(`Couldn't save it: ${err instanceof Error ? err.message : String(err)}. Try again.`)
    } finally {
      setSubmitting(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    if (listOpen) {
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length > 0) {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlighted((shown + step + suggestions.length) % suggestions.length)
        return
      }
      if ((event.key === 'Enter' || (event.key === 'Tab' && plain)) && suggestions.length > 0) {
        event.preventDefault()
        pick(suggestions[shown])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setListClosed(true)
        return
      }
    }
    if (event.key === 'Tab' && plain) {
      event.preventDefault()
      switchKind()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (!submitting) void hudApi.hide()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    }
  }

  const kindLabel = parsed.kind === 'task' ? 'Task' : 'Log'
  const optionId = (index: number): string => `${listId}-${index}`

  return (
    <div ref={shellRef} className="hud-shell">
      <div className="hud" data-error={error ? true : undefined}>
        <div className="hud-bar">
          <button
            type="button"
            className="hud-kind"
            tabIndex={-1}
            onMouseDown={event => event.preventDefault()}
            onClick={switchKind}
            aria-label={parsed.kind === 'task' ? 'Saving a task. Switch to a log entry' : 'Saving a log entry. Switch to a task'}
            title="Switch between a log entry and a task (Tab)"
          >
            {submitting
              ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              : parsed.kind === 'task' ? <SquareCheck size={14} aria-hidden="true" /> : <NotebookPen size={14} aria-hidden="true" />}
            {kindLabel}
            <Key>Tab</Key>
          </button>

          <input
            ref={inputRef}
            type="text"
            className="hud-input"
            value={value}
            onChange={event => edit(event.target.value, event.target.selectionStart ?? event.target.value.length)}
            onSelect={event => setCaret(event.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKeyDown}
            placeholder="Capture a thought, or start with - for a task"
            aria-label="Quick capture"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls={suggestions.length > 0 ? listId : undefined}
            aria-activedescendant={suggestions.length > 0 ? optionId(shown) : undefined}
            aria-invalid={error ? true : undefined}
            disabled={submitting}
            spellCheck={false}
          />

          <span className="hud-dest" title={destination ? `Saves to ${destination.name}` : undefined}>
            <span className="hud-dot" style={{ '--hud-dot': (destination ?? current).color } as React.CSSProperties} aria-hidden="true" />
            <span className="hud-dest-name">{destination ? destination.name : current.name}</span>
          </span>
        </div>

        {listOpen && (
          <ul id={listId} className="hud-list" role="listbox" aria-label={typing?.marker === '@' ? 'Workspaces' : 'Tags'}>
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.kind === 'workspace' ? suggestion.entry.slug : suggestion.tag.id}
                id={optionId(index)}
                className="hud-option"
                role="option"
                aria-selected={index === shown}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => pick(suggestion)}
              >
                {suggestion.kind === 'workspace' ? (
                  <>
                    <span className="hud-dot" style={{ '--hud-dot': suggestion.entry.color } as React.CSSProperties} aria-hidden="true" />
                    {suggestion.entry.name}
                    {suggestion.current && <span className="hud-option-note">current</span>}
                  </>
                ) : (
                  <>
                    <span className="hud-dot" style={{ '--hud-dot': suggestion.tag.color } as React.CSSProperties} aria-hidden="true" />
                    #{suggestion.tag.name}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <div className="hud-foot hud-foot-error" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            {error}
          </div>
        ) : listOpen ? (
          <div className="hud-foot">
            <span className="hud-hint"><Key>↑</Key><Key>↓</Key> choose</span>
            <span className="hud-hint"><Key>Enter</Key> pick</span>
            <span className="hud-hint hud-push"><Key>Esc</Key> back to typing</span>
          </div>
        ) : value.trim() !== '' ? (
          // what gets made, read back before it's saved
          <div className="hud-foot">
            {parsed.dueAt !== null && (
              <span className="hud-chip" title={parsed.dueSource ? `from "${parsed.dueSource}"` : undefined}>
                <Calendar size={12} aria-hidden="true" />
                {formatDue(parsed.dueAt)}
              </span>
            )}
            {parsed.priority > 0 && (
              <span className="hud-chip" style={{ color: PRIORITY_COLORS[parsed.priority] }}>
                <Flag size={12} aria-hidden="true" />
                {PRIORITY_NAMES[parsed.priority]}
              </span>
            )}
            {parsed.tags.map(tag => (
              <span key={tag} className="hud-chip">
                <Hash size={12} aria-hidden="true" />
                {tag}
              </span>
            ))}
            {destination ? (
              <span className="hud-hint hud-push"><Key>Enter</Key> save to {destination.name}</span>
            ) : (
              // a wrong @ shows while it's typed, not after Enter
              <span className="hud-hint hud-push hud-warn">No workspace called “{parsed.workspace}”</span>
            )}
          </div>
        ) : (
          <div className="hud-foot">
            <span className="hud-hint"><Key>-</Key> task</span>
            <span className="hud-hint"><Key>@</Key> workspace</span>
            <span className="hud-hint"><Key>#</Key> tag</span>
            <span className="hud-hint"><Key>!high</Key> priority</span>
            <span className="hud-hint"><Key>fri 3pm</Key> due</span>
            <span className="hud-hint hud-push"><Key>Enter</Key> save <Key>Esc</Key> close</span>
          </div>
        )}
      </div>
    </div>
  )
}
