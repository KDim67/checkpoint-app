import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft, FileText } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { rankCommands } from '../../../shared/commandMatch'
import { buildCommands, type Command } from '../lib/commands'
import { VIEW_FEATURES } from '../lib/features'
import { getBoolSetting } from '../lib/settings'
import { searchEverything, MIN_QUERY_LENGTH } from '../lib/globalSearch'
import { kindLabel, type SearchHit } from '../../../shared/searchResults'
import type { ActiveView } from '../store/appStore'

interface Props {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: Props): React.JSX.Element | null {
  const setView = useAppStore(s => s.setView)
  const setContext = useAppStore(s => s.setContext)
  const setSettingsTab = useAppStore(s => s.setSettingsTab)
  const setRightPanelContent = useAppStore(s => s.setRightPanelContent)
  const toggleRightPanel = useAppStore(s => s.toggleRightPanel)
  const activeContext = useAppStore(s => s.activeContext)
  const availableContexts = useAppStore(s => s.availableContexts)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [enabledViews, setEnabledViews] = useState<Partial<Record<ActiveView, boolean>>>({})
  const [hits, setHits] = useState<SearchHit[]>([])
  const selectItem = useAppStore(s => s.selectItem)
  const setRightPanel = useAppStore(s => s.setRightPanelContent)
  const setPendingNoteTitle = useAppStore(s => s.setPendingNoteTitle)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Read once per opening: a view toggled off while the palette is shut should
  // not still be offered the next time it opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    let cancelled = false
    const load = async () => {
      const entries = await Promise.all(
        // getBoolSetting rather than a raw read: these keys are written as both
        // a boolean and the string "false" depending on which panel wrote them,
        // and Game Dev defaults to off, so an unset key is not the same as on.
        VIEW_FEATURES.map(async f => [f.view, await getBoolSetting(f.key, f.defaultOn)] as const)
      )
      if (!cancelled) setEnabledViews(Object.fromEntries(entries) as Partial<Record<ActiveView, boolean>>)
    }
    load()
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open) { setHits([]); return }
    const q = query.trim()
    if (q.length < MIN_QUERY_LENGTH) { setHits([]); return }

    let cancelled = false
    const timer = setTimeout(async () => {
      const found = await searchEverything(q, activeContext)
      // Guarded because a slower earlier query can land after a faster later
      // one, which would show results for something no longer typed.
      if (!cancelled) setHits(found)
    }, 140)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, query, activeContext])

  const commands = useMemo(
    () =>
      buildCommands({
        setView,
        setContext,
        setSettingsTab,
        setRightPanelContent,
        toggleRightPanel,
        contexts: availableContexts,
        activeContext,
        enabledViews
      }),
    [setView, setContext, setSettingsTab, setRightPanelContent, toggleRightPanel, availableContexts, activeContext, enabledViews]
  )

  const results = useMemo(() => rankCommands(commands, query), [commands, query])

  // One flat list so the arrow keys and Enter cross the boundary without the
  // user having to think about which half they are in.
  const rows = useMemo(
    () => [
      ...results.map(command => ({ type: 'command' as const, command })),
      ...hits.map(hit => ({ type: 'hit' as const, hit }))
    ],
    [results, hits]
  )

  // Clamped rather than reset: typing a narrower query should not throw away the
  // selection when the highlighted row is still in the list.
  const active = Math.min(selected, Math.max(0, rows.length - 1))

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const runCommand = async (command: Command) => {
    onClose()
    try {
      await command.run()
    } catch (err) {
      console.error(`[palette] "${command.label}" failed:`, err)
    }
  }

  const openHit = (hit: SearchHit) => {
    onClose()
    if (!hit.target) return
    switch (hit.kind) {
      case 'note':
        // Parked in the store rather than dispatched: setView only schedules a
        // render, so NotesView has not mounted yet and would miss an event.
        setPendingNoteTitle(hit.target)
        setView('notes')
        break
      case 'cheatsheet':
        setView('cheatsheets')
        break
      case 'log':
        setView('log')
        selectItem(hit.target)
        break
      case 'task':
        setView('backlog')
        selectItem(hit.target)
        break
      default:
        setView('kanban')
        selectItem(hit.target)
        setRightPanel('item-detail')
    }
  }

  const activate = (index: number) => {
    const row = rows[index]
    if (!row) return
    if (row.type === 'command') runCommand(row.command)
    else openHit(row.hit)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(i => (rows.length === 0 ? 0 : (Math.min(i, rows.length - 1) + 1) % rows.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(i => (rows.length === 0 ? 0 : (Math.min(i, rows.length - 1) - 1 + rows.length) % rows.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let lastGroup = ''

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        // Sits above the right panel and every popover, below nothing.
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh'
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          width: 'min(560px, 92vw)',
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-2xl)',
          overflow: 'hidden'
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-surface-offset)'
        }}>
          <Search size={15} style={{ color: 'var(--color-text-faint)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search commands…"
            aria-label="Search commands"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--color-text-base)',
              fontSize: 'var(--text-sm)'
            }}
          />
        </div>

        <div ref={listRef} style={{ maxHeight: '52vh', overflowY: 'auto', padding: 'var(--space-1)' }}>
          {rows.length === 0 && (
            <div style={{
              padding: 'var(--space-4)',
              textAlign: 'center',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-faint)'
            }}>
              {query.trim().length >= MIN_QUERY_LENGTH
                ? `Nothing matches "${query.trim()}".`
                : 'Type to search commands, cards, notes and cheatsheets.'}
            </div>
          )}

          {rows.map((row, index) => {
            const isActive = index === active
            const key = row.type === 'command' ? row.command.id : row.hit.id

            // Group headings only make sense while the authored order still
            // holds; once rows are score-ordered they would appear to repeat.
            let heading: string | null = null
            if (row.type === 'command' && !query.trim() && row.command.group !== lastGroup) {
              heading = row.command.group
              lastGroup = row.command.group
            } else if (row.type === 'hit' && lastGroup !== 'Results') {
              heading = 'Results'
              lastGroup = 'Results'
            }

            const label = row.type === 'command' ? row.command.label : row.hit.title
            const meta =
              row.type === 'command'
                ? (query.trim() ? row.command.group : row.command.hint)
                : kindLabel(row.hit.kind)

            return (
              <React.Fragment key={key}>
                {heading && (
                  <div style={{
                    padding: 'var(--space-2) var(--space-3) var(--space-1)',
                    fontSize: '10px',
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--color-text-faint)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-wider)'
                  }}>
                    {heading}
                  </div>
                )}
                <div
                  data-index={index}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => activate(index)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: isActive ? 'var(--color-secondary-muted)' : 'transparent',
                    color: isActive ? 'var(--color-secondary)' : 'var(--color-text-base)',
                    fontSize: 'var(--text-sm)'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    {row.type === 'hit' && <FileText size={13} style={{ flexShrink: 0, opacity: 0.7 }} />}
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label}
                      </span>
                      {row.type === 'hit' && row.hit.subtitle && (
                        <span style={{
                          display: 'block',
                          fontSize: '11px',
                          color: 'var(--color-text-faint)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {row.hit.subtitle}
                        </span>
                      )}
                    </span>
                  </span>
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    flexShrink: 0,
                    fontSize: '11px',
                    color: isActive ? 'var(--color-secondary)' : 'var(--color-text-faint)'
                  }}>
                    {meta}
                    {isActive && <CornerDownLeft size={12} />}
                  </span>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
