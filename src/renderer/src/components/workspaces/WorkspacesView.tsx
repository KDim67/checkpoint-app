/** every workspace as a lane, opened from the logo: a click or Enter switches and goes back, and every change to them happens here */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, Upload } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useFailureReport } from '../ui/Toast'
import WorkspaceLane from './WorkspaceLane'
import WorkspaceFormDialog from './WorkspaceFormDialog'
import ImportWorkspaceDialog from './ImportWorkspaceDialog'
import RemoveWorkspaceDialog from './RemoveWorkspaceDialog'
import { useWorkspaces, type ImportDraft } from './useWorkspaces'
import { matching, nextColor } from '../../lib/workspaceEdits'
import { openItem } from '../../lib/openItem'
import { withViewTransition } from '../../lib/viewTransition'
import { workspaceActivity } from '../../data/workspaces'
import { firstDayOfWeek } from '../../../../shared/calendar'
import { laneOf, type ActivityBySlug, type LastChange } from '../../../../shared/workspaceLanes'
import Presence from '../ui/Presence'
import { SkeletonBlocks } from '../ui/Skeleton'

type Dialog =
  | { kind: 'new'; name: string }
  | { kind: 'edit'; slug: string; field: 'name' | 'repo' }
  | { kind: 'import'; draft: ImportDraft }
  | { kind: 'remove'; slug: string }

/** a press has to travel this far to become a drag, so clicks stay clicks */
const DRAG_DISTANCE = 6
/** the click that ends a drag arrives straight after it, and mustn't also switch */
const DRAG_SETTLE_MS = 250

export default function WorkspacesView(): React.JSX.Element {
  const workspaces = useWorkspaces()
  const { list, loading, move } = workspaces
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setWorkspace = useAppStore(s => s.setWorkspace)
  const goBack = useAppStore(s => s.goBack)
  const pendingCreate = useAppStore(s => s.pendingCreate)
  const setPendingCreate = useAppStore(s => s.setPendingCreate)
  const report = useFailureReport()

  const [activity, setActivity] = useState<ActivityBySlug | null>(null)
  const [now] = useState(() => Date.now())
  const weekStart = useMemo(() => firstDayOfWeek(navigator.language), [])
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(activeWorkspace)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const pageRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const laneButtons = useRef(new Map<string, HTMLButtonElement>())
  const dragEndedAt = useRef(0)

  const loadActivity = useCallback(() => {
    workspaceActivity()
      .then(setActivity)
      .catch(err => {
        // empty lanes beat a page stuck loading
        setActivity({})
        report('read what each workspace holds', err)
      })
  }, [report])
  useEffect(loadActivity, [loadActivity])

  const lanes = useMemo(
    () => new Map(list.map(entry => [entry.slug, laneOf(activity?.[entry.slug], now, weekStart)])),
    [list, activity, now, weekStart]
  )
  const shown = useMemo(() => matching(list, query), [list, query])
  const filtered = query.trim() !== ''

  const switchTo = useCallback((slug: string) => {
    setWorkspace(slug)
    goBack()
  }, [goBack, setWorkspace])
  const openLastChange = useCallback((slug: string, change: LastChange) => {
    setWorkspace(slug)
    openItem(change.type, change.id)
  }, [setWorkspace])

  const focusLane = useCallback((slug: string) => {
    setFocused(slug)
    // after the render that may have just moved it
    requestAnimationFrame(() => laneButtons.current.get(slug)?.focus())
  }, [])

  // lands on the lane for where you are, so the arrows and Enter work straight away
  const arrived = useRef(false)
  useEffect(() => {
    if (loading || arrived.current || list.length === 0) return
    arrived.current = true
    focusLane(list.some(entry => entry.slug === activeWorkspace) ? activeWorkspace : list[0].slug)
  }, [loading, list, activeWorkspace, focusLane])

  // the palette, or a view's New Workspace, parks the ask here
  useEffect(() => {
    if (pendingCreate !== 'workspace') return
    setPendingCreate(null)
    setDialog({ kind: 'new', name: '' })
  }, [pendingCreate, setPendingCreate])

  // with the focused lane filtered away, Tab still needs a lane to land on
  const tabStop = shown.some(entry => entry.slug === focused) ? focused : shown[0]?.slug
  const selected = shown.find(entry => entry.slug === tabStop)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }))
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    dragEndedAt.current = Date.now()
    if (!over || active.id === over.id) return
    void workspaces.moveTo(list.findIndex(e => e.slug === active.id), list.findIndex(e => e.slug === over.id))
  }
  const settlingDrag = useCallback(() => Date.now() - dragEndedAt.current < DRAG_SETTLE_MS, [])

  // on the window, not the lanes: a click on the page's empty space, or beside it, takes focus off them and left every key dead
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const page = pageRef.current
      const target = event.target as HTMLElement
      if (!page || !(page.contains(target) || target === document.body) || event.defaultPrevented) return
      // a dialog or menu open here takes its own keys
      if (document.querySelector('[role="dialog"]') || target.closest('[role="menu"]')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        // a filter is cleared first, then Escape goes back
        if (query) setQuery('')
        else withViewTransition(goBack)
        return
      }
      // the filter keeps the rest of its keys
      if (target.closest('input, textarea, select, [contenteditable="true"]') || shown.length === 0 || !tabStop) return
      const at = Math.max(0, shown.findIndex(entry => entry.slug === tabStop))
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        // reordering part of the list would be guesswork
        if (filtered) return
        void move(tabStop, event.key === 'ArrowUp' ? -1 : 1).then(() => focusLane(tabStop))
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusLane(shown[Math.min(at + 1, shown.length - 1)].slug)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (at === 0) filterRef.current?.focus()
        else focusLane(shown[at - 1].slug)
      } else if (event.key === 'Home') {
        event.preventDefault()
        focusLane(shown[0].slug)
      } else if (event.key === 'End') {
        event.preventDefault()
        focusLane(shown[shown.length - 1].slug)
      } else if (event.key === 'Enter') {
        // a focused button's Enter is its own click, which on a lane switches already
        if (target.closest('button')) return
        event.preventDefault()
        switchTo(tabStop)
      } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // typing goes to the filter, as in a file list
        event.preventDefault()
        setQuery(current => current + event.key)
        filterRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, focusLane, goBack, move, query, shown, switchTo, tabStop])

  const onFilterKey = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && shown.length > 0) {
      event.preventDefault()
      focusLane(shown[0].slug)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      // the lane shown as selected, which is the first match once typing has filtered the one picked before away
      if (tabStop) switchTo(tabStop)
      else if (filtered) setDialog({ kind: 'new', name: query.trim() })
    }
  }

  const startImport = async (): Promise<void> => {
    const draft = await workspaces.startImport()
    if (draft) setDialog({ kind: 'import', draft })
  }

  const editing = dialog?.kind === 'edit' ? list.find(entry => entry.slug === dialog.slug) : undefined
  const removing = dialog?.kind === 'remove' ? list.find(entry => entry.slug === dialog.slug) : undefined
  const closeDialog = (): void => setDialog(null)

  return (
    <div ref={pageRef} className="ws-page" tabIndex={-1}>
      <header className="ws-head">
        <h1 className="ws-title">
          Workspaces <span className="ws-total">{list.length}</span>
        </h1>
        <span className="ws-head-gap" />
        <input
          ref={filterRef}
          type="search"
          className="input-base ws-filter"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={onFilterKey}
          placeholder="Filter, or type a new name"
          aria-label="Filter workspaces, or type a name to create one"
          aria-controls="ws-lanes"
        />
        <button type="button" className="btn-secondary ws-head-button" onClick={() => void startImport()}>
          <Upload size={14} aria-hidden="true" />
          Import
        </button>
        <button type="button" className="btn-primary ws-head-button" onClick={() => setDialog({ kind: 'new', name: query.trim() })}>
          <Plus size={14} aria-hidden="true" />
          New workspace
        </button>
      </header>

      {loading ? (
        <SkeletonBlocks label="Loading your workspaces" count={3} height="4.5rem" gap="var(--space-2)" style={{ padding: 'var(--space-2) 0' }} />
      ) : shown.length === 0 ? (
        <div className="ws-empty" role="status">
          <span>No workspace matches “{query.trim()}”.</span>
          <button type="button" className="btn-secondary" onClick={() => setDialog({ kind: 'new', name: query.trim() })}>
            Create “{query.trim()}”
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragCancel={() => { dragEndedAt.current = Date.now() }}>
          <SortableContext items={shown.map(entry => entry.slug)} strategy={verticalListSortingStrategy}>
            <ul id="ws-lanes" className="ws-lanes" aria-label="Workspaces">
              {shown.map(entry => {
                const lane = lanes.get(entry.slug) ?? laneOf(undefined, now, weekStart)
                const index = list.indexOf(entry)
                return (
                  <WorkspaceLane
                    key={entry.slug}
                    entry={entry}
                    lane={lane}
                    ready={activity !== null}
                    current={entry.slug === activeWorkspace}
                    tabStop={entry.slug === tabStop}
                    canRemove={list.length > 1}
                    sortable={!filtered}
                    canMoveUp={index > 0}
                    canMoveDown={index < list.length - 1}
                    settlingDrag={settlingDrag}
                    buttonRef={el => {
                      if (el) laneButtons.current.set(entry.slug, el)
                      else laneButtons.current.delete(entry.slug)
                    }}
                    onFocused={() => setFocused(entry.slug)}
                    onSwitch={() => switchTo(entry.slug)}
                    onOpenLastChange={change => openLastChange(entry.slug, change)}
                    onEdit={field => setDialog({ kind: 'edit', slug: entry.slug, field })}
                    onMove={by => void move(entry.slug, by)}
                    onExport={() => void workspaces.exportOne(entry)}
                    onUnshare={() => void workspaces.unshare(entry.slug)}
                    onRemove={() => setDialog({ kind: 'remove', slug: entry.slug })}
                  />
                )
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <footer className="ws-foot">
        <span className="ws-legend"><span className="ws-legend-bar" aria-hidden="true" />focus per day</span>
        <span className="ws-legend"><span className="ws-mark" aria-hidden="true" />due</span>
        <span className="ws-legend"><span className="ws-mark ws-mark-late" aria-hidden="true" />late</span>
        <span className="ws-legend"><span className="ws-legend-today" aria-hidden="true" />today</span>
        {/* what each key does right now, by name, and only the ones that do something */}
        <span className="ws-keys">
          {shown.length > 1 && <span className="ws-key"><kbd>↑</kbd><kbd>↓</kbd>Choose</span>}
          {selected && (
            <span className="ws-key">
              <kbd>Enter</kbd>
              <span className="ws-key-what">{selected.slug === activeWorkspace ? `Stay in ${selected.name}` : `Switch to ${selected.name}`}</span>
            </span>
          )}
          {!filtered && list.length > 1 && <span className="ws-key"><kbd>Alt</kbd><kbd>↑</kbd><kbd>↓</kbd>Move</span>}
          <span className="ws-key"><kbd>Esc</kbd>{filtered ? 'Clear filter' : 'Back'}</span>
        </span>
      </footer>

      <Presence show={dialog?.kind === 'new'}>
      {dialog?.kind === 'new' && (
        <WorkspaceFormDialog
          mode="new"
          initial={{ name: dialog.name, color: nextColor(list), gitPath: '' }}
          onSubmit={async fields => {
            const outcome = await workspaces.create(fields)
            if (outcome.ok && outcome.slug) switchTo(outcome.slug)
            return outcome
          }}
          onClose={closeDialog}
        />
      )}
      </Presence>
      <Presence show={dialog?.kind === 'edit' && !!editing}>
      {dialog?.kind === 'edit' && editing && (
        <WorkspaceFormDialog
          mode="edit"
          focus={dialog.field}
          initial={{ name: editing.name, color: editing.color, gitPath: editing.gitPath ?? '', slug: editing.slug, icon: editing.icon }}
          onSubmit={async fields => {
            const outcome = await workspaces.update(editing.slug, fields)
            // a new short name moved its data, which is read again under it
            if (outcome.ok) loadActivity()
            return outcome
          }}
          onClose={closeDialog}
        />
      )}
      </Presence>
      <Presence show={dialog?.kind === 'import'}>
      {dialog?.kind === 'import' && (
        <ImportWorkspaceDialog
          draft={dialog.draft}
          taken={list.map(entry => entry.slug)}
          onSubmit={async name => {
            const outcome = await workspaces.finishImport(dialog.draft, name)
            if (outcome.ok && outcome.slug) switchTo(outcome.slug)
            return outcome
          }}
          onClose={closeDialog}
        />
      )}
      </Presence>
      <Presence show={!!removing}>
      {removing && (
        <RemoveWorkspaceDialog
          entry={removing}
          onConfirm={() => {
            closeDialog()
            void workspaces.remove(removing.slug)
          }}
          onClose={closeDialog}
        />
      )}
      </Presence>
    </div>
  )
}
