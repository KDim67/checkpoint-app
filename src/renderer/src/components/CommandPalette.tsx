import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { rankCommands } from '../../../shared/commandMatch'
import { buildCommands, type Command } from '../lib/commands'
import { VIEW_FEATURES } from '../lib/features'
import { getBoolSetting } from '../lib/settings'
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

  // Clamped rather than reset: typing a narrower query should not throw away the
  // selection when the highlighted row is still in the list.
  const active = Math.min(selected, Math.max(0, results.length - 1))

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(i => (results.length === 0 ? 0 : (Math.min(i, results.length - 1) + 1) % results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(i => (results.length === 0 ? 0 : (Math.min(i, results.length - 1) - 1 + results.length) % results.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const command = results[active]
      if (command) runCommand(command)
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
          {results.length === 0 && (
            <div style={{
              padding: 'var(--space-4)',
              textAlign: 'center',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-faint)'
            }}>
              No commands match “{query}”.
            </div>
          )}

          {results.map((command, index) => {
            // Headings only make sense while the authored order still holds;
            // once results are score-ordered they would appear to repeat.
            const showGroup = !query.trim() && command.group !== lastGroup
            if (showGroup) lastGroup = command.group
            const isActive = index === active
            return (
              <React.Fragment key={command.id}>
                {showGroup && (
                  <div style={{
                    padding: 'var(--space-2) var(--space-3) var(--space-1)',
                    fontSize: '10px',
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--color-text-faint)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-wider)'
                  }}>
                    {command.group}
                  </div>
                )}
                <div
                  data-index={index}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => runCommand(command)}
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
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {command.label}
                  </span>
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    flexShrink: 0,
                    fontSize: '11px',
                    color: isActive ? 'var(--color-secondary)' : 'var(--color-text-faint)'
                  }}>
                    {query.trim() ? command.group : command.hint}
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
