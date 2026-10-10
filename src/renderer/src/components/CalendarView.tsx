/** everything in the app that has a date, on one calendar you can plan on */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Layers, Plus, TriangleAlert } from 'lucide-react'
import MonthView from './calendar/MonthView'
import WeekView from './calendar/WeekView'
import AgendaView from './calendar/AgendaView'
import QuickAdd from './calendar/QuickAdd'
import ShowMenu from './calendar/ShowMenu'
import CalendarsModal from './calendar/CalendarsModal'
import { DayList, EntryDetails } from './calendar/EntryDetails'
import { CalendarActionsContext, DRAG_TYPE, type CalendarActions } from './calendar/actions'
import { byDay, rangeOf, step, titleOf, visibleDays, type CalendarViewKind } from './calendar/layout'
import { useToast } from './ui/Toast'
import { useAppStore } from '../store/appStore'
import { getBoolSetting, getEnumSetting, getJsonSetting, setBoolSetting, setJsonSetting, setStringSetting } from '../lib/settings'
import * as calendarApi from '../data/calendar'
import {
  CALENDAR_LAYERS,
  dayKey,
  dueForDrop,
  dueForNew,
  firstDayOfWeek,
  type CalendarAnswer,
  type CalendarEntry,
  type CalendarLayer,
  type DropTarget
} from '../../../shared/calendar'
import { isAllDay, localDayOf, type CalendarDay } from '../../../shared/dueDate'
import type { CalendarSubscription } from '../../../shared/calendarApi'

// remembered per computer: none of these are in the synced list
const VIEW_SETTING = 'calendar_view'
const LAYERS_SETTING = 'calendar_layers'
const ALL_SETTING = 'calendar_all_workspaces'
// a calendar older than this is fetched again when the tab opens
const STALE_ON_OPEN_MS = 15 * 60_000
const MINUTE = 60_000

const VIEWS: { id: CalendarViewKind; label: string; key: string }[] = [
  { id: 'month', label: 'Month', key: 'M' },
  { id: 'week', label: 'Week', key: 'W' },
  { id: 'agenda', label: 'Agenda', key: 'A' }
]

const DEFAULT_LAYERS = CALENDAR_LAYERS.filter(l => l.defaultOn).map(l => l.id)

type Open =
  | { kind: 'quick'; target: DropTarget; at: { x: number; y: number } }
  | { kind: 'details'; entry: CalendarEntry; at: { x: number; y: number } }
  | { kind: 'day'; day: CalendarDay; at: { x: number; y: number } }
  | { kind: 'show'; at: { x: number; y: number } }

const below = (el: HTMLElement): { x: number; y: number } => {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.bottom + 4 }
}

/** typing, or a field that wants its own keys, keeps the calendar's letters out of the way */
const typing = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** a due date in words: its own date for a whole day, the local date and time for a moment */
function dueText(due: number): string {
  if (isAllDay(due)) return new Date(due).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return `${new Date(due).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, ${new Date(due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

const whenText = (target: DropTarget): string => dueText(dueForNew(target))

export default function CalendarView(): React.JSX.Element {
  const { toast } = useToast()
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const workspaceList = useAppStore(s => s.workspaceList)
  const setView = useAppStore(s => s.setView)
  const setWorkspace = useAppStore(s => s.setWorkspace)
  const selectItem = useAppStore(s => s.selectItem)
  const setRightPanelContent = useAppStore(s => s.setRightPanelContent)
  const setPendingRenewalId = useAppStore(s => s.setPendingRenewalId)
  const setPendingRecurring = useAppStore(s => s.setPendingRecurring)

  const [ready, setReady] = useState(false)
  const [view, setCalendarView] = useState<CalendarViewKind>('month')
  const [layers, setLayers] = useState<Set<CalendarLayer>>(new Set(DEFAULT_LAYERS))
  const [allWorkspaces, setAllWorkspaces] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const today = useMemo(() => localDayOf(now), [now])
  const [anchor, setAnchor] = useState<CalendarDay>(() => localDayOf(Date.now()))
  const [answer, setAnswer] = useState<CalendarAnswer>({ entries: [], problems: [] })
  const [subscriptions, setSubscriptions] = useState<CalendarSubscription[]>([])
  const [open, setOpen] = useState<Open | null>(null)
  const [managing, setManaging] = useState(false)
  const request = useRef(0)

  const weekStart = useMemo(() => firstDayOfWeek(navigator.language), [])
  const days = useMemo(() => visibleDays(view, anchor, weekStart), [view, anchor, weekStart])
  const range = useMemo(() => rangeOf(days), [days])
  const contents = useMemo(() => byDay(answer.entries, days, today), [answer.entries, days, today])

  useEffect(() => {
    void (async () => {
      const [savedView, savedLayers, savedAll] = await Promise.all([
        getEnumSetting(VIEW_SETTING, ['month', 'week', 'agenda'] as const, 'month'),
        getJsonSetting<CalendarLayer[] | null>(LAYERS_SETTING, null),
        getBoolSetting(ALL_SETTING, false)
      ])
      setCalendarView(savedView)
      if (Array.isArray(savedLayers)) setLayers(new Set(savedLayers.filter(l => CALENDAR_LAYERS.some(c => c.id === l))))
      setAllWorkspaces(savedAll)
      setReady(true)
    })()
  }, [])

  const load = useCallback(async () => {
    if (!ready) return
    const id = ++request.current
    const result = await calendarApi.entries({ ...range, workspaces: allWorkspaces ? null : [activeWorkspace], layers: [...layers] })
    // a slower answer for a page already left behind is dropped
    if (id !== request.current) return
    if (result.ok) setAnswer(result.value)
    else setAnswer({ entries: [], problems: [{ layer: 'due', message: result.reason }] })
  }, [ready, range, allWorkspaces, activeWorkspace, layers])

  const loadSubscriptions = useCallback(async () => {
    const result = await calendarApi.subscriptions()
    if (result.ok) setSubscriptions(result.value)
  }, [])

  useEffect(() => { void load() }, [load])

  // anything changed elsewhere, by hand, by an agent or by sync, shows here too
  useEffect(() => {
    const again = (): void => { void load() }
    window.addEventListener('kanban-refresh', again)
    window.addEventListener('item-updated', again)
    const off = calendarApi.onChanged(() => {
      void load()
      void loadSubscriptions()
    })
    return () => {
      window.removeEventListener('kanban-refresh', again)
      window.removeEventListener('item-updated', again)
      off()
    }
  }, [load, loadSubscriptions])

  useEffect(() => {
    void (async () => {
      await loadSubscriptions()
      const fresh = await calendarApi.refresh(false, STALE_ON_OPEN_MS)
      if (fresh.ok && fresh.value) void loadSubscriptions()
    })()
  }, [loadSubscriptions])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE)
    return () => clearInterval(timer)
  }, [])

  const changeView = useCallback((next: CalendarViewKind) => {
    setCalendarView(next)
    // the agenda reads from today; month and week keep the day you were on
    if (next === 'agenda') setAnchor(localDayOf(Date.now()))
    void setStringSetting(VIEW_SETTING, next)
  }, [])

  const toggleLayer = (layer: CalendarLayer): void => {
    setLayers(current => {
      const next = new Set(current)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      void setJsonSetting(LAYERS_SETTING, [...next])
      return next
    })
  }

  const toggleAll = (): void => {
    setAllWorkspaces(v => {
      void setBoolSetting(ALL_SETTING, !v)
      return !v
    })
  }

  const goToday = useCallback(() => setAnchor(localDayOf(Date.now())), [])
  const page = useCallback((direction: 1 | -1) => setAnchor(a => step(view, a, direction)), [view])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (open || managing || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 't') goToday()
      else if (key === 'j' || e.key === 'ArrowRight') page(1)
      else if (key === 'k' || e.key === 'ArrowLeft') page(-1)
      else if (key === 'm') changeView('month')
      else if (key === 'w') changeView('week')
      else if (key === 'a') changeView('agenda')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, managing, goToday, page, changeView])

  const workspaceColor = useMemo(() => new Map(workspaceList.map(w => [w.slug, w.color])), [workspaceList])
  const workspaceName = useMemo(() => new Map(workspaceList.map(w => [w.slug, w.name])), [workspaceList])

  const move = useCallback(async (entry: CalendarEntry, due: number) => {
    if (entry.ref.kind !== 'item') return
    const itemId = entry.ref.id
    // drawn where it was dropped at once; the answer from main replaces it
    setAnswer(a => ({ ...a, entries: a.entries.map(e => (e.id === entry.id ? { ...e, start: due, allDay: isAllDay(due) } : e)) }))
    const result = await calendarApi.move(itemId, due)
    if (!result.ok) {
      toast(`Couldn't move "${entry.title}": ${result.reason}`, { type: 'error' })
      void load()
      return
    }
    const previous = result.value.previous
    toast(`Moved "${entry.title}" to ${dueText(due)}`, {
      action: previous === null ? undefined : {
        label: 'Undo',
        onClick: () => { void calendarApi.move(itemId, previous).then(() => load()) }
      }
    })
    void load()
  }, [load, toast])

  const actions: CalendarActions = useMemo(() => ({
    open: (entry, anchorEl) => {
      if (entry.ref.kind === 'item') {
        selectItem(entry.ref.id)
        setRightPanelContent('item-detail')
      } else if (entry.ref.kind === 'renewal') {
        setPendingRenewalId(entry.ref.id)
        setView('renewals')
      } else {
        setOpen({ kind: 'details', entry, at: below(anchorEl) })
      }
    },
    showDay: (day, anchorEl) => setOpen({ kind: 'day', day, at: below(anchorEl) }),
    add: (target, at) => setOpen({ kind: 'quick', target, at }),
    drop: (target, event) => {
      const id = event.dataTransfer.getData(DRAG_TYPE)
      const entry = answer.entries.find(e => e.id === id)
      if (!entry || !entry.movable) return
      event.preventDefault()
      const due = dueForDrop(entry.start, target)
      if (due !== entry.start) void move(entry, due)
    },
    colorOf: entry => {
      if (entry.layer === 'events' && entry.color) return entry.color
      if (allWorkspaces && entry.workspace) return workspaceColor.get(entry.workspace) ?? `var(--cal-layer-${entry.layer})`
      return `var(--cal-layer-${entry.layer})`
    },
    workspaceLabel: entry => (allWorkspaces && entry.workspace ? workspaceName.get(entry.workspace) ?? entry.workspace : null)
  }), [answer.entries, allWorkspaces, move, selectItem, setPendingRenewalId, setRightPanelContent, setView, workspaceColor, workspaceName])

  const addFromCalendar = async (target: DropTarget, input: { title: string; type: 'task' | 'card'; context: string }): Promise<boolean> => {
    const result = await calendarApi.quickAdd({ ...input, due: dueForNew(target) })
    if (!result.ok) {
      toast(`Couldn't add it: ${result.reason}`, { type: 'error' })
      return false
    }
    toast(`Added "${result.value.title}"`)
    void load()
    return true
  }

  const openRepeats = (entry: CalendarEntry): void => {
    setOpen(null)
    if (entry.workspace && entry.workspace !== activeWorkspace) setWorkspace(entry.workspace)
    setPendingRecurring(true)
    setView('backlog')
  }

  const dayEntries = (day: CalendarDay): CalendarEntry[] => {
    const cell = contents.get(dayKey(day))
    return [...(cell?.entries ?? []), ...(cell?.counts.log ?? []), ...(cell?.counts.commits ?? [])]
  }

  const title = titleOf(view, anchor, days)

  return (
    <CalendarActionsContext.Provider value={actions}>
      <div className="cal-view">
        <div className="cal-toolbar">
          <div className="cal-toolbar-group">
            <button type="button" className="btn-secondary" onClick={goToday} title="Today (T)">Today</button>
            <button type="button" className="btn-ghost" onClick={() => page(-1)} aria-label="Back" title="Back (K)">
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" className="btn-ghost" onClick={() => page(1)} aria-label="Forward" title="Forward (J)">
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <h1 className="cal-title" aria-live="polite">{title}</h1>
          </div>
          <div className="cal-toolbar-group">
            <span className="row-4px" role="radiogroup" aria-label="View">
              {VIEWS.map(v => (
                <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className="renewal-filter"
                  title={`${v.label} (${v.key})`} onClick={() => changeView(v.id)}>
                  {v.label}
                </button>
              ))}
            </span>
            <button type="button" className="renewal-filter" aria-pressed={allWorkspaces} onClick={toggleAll}>
              All workspaces
            </button>
            <button type="button" className="btn-ghost" onClick={e => setOpen({ kind: 'show', at: below(e.currentTarget) })}
              aria-label={answer.problems.length ? 'Show, a layer has a problem' : 'Show'}>
              <span className="row-4px">
                {answer.problems.length > 0 ? <TriangleAlert size={14} className="icon-warning" aria-hidden="true" /> : <Layers size={14} aria-hidden="true" />}
                Show
              </span>
            </button>
            <button type="button" className="btn-ghost" onClick={() => setManaging(true)}>
              <span className="row-4px"><CalendarDays size={14} aria-hidden="true" />Calendars</span>
            </button>
            <button type="button" className="btn-primary" onClick={e => {
              const r = e.currentTarget.getBoundingClientRect()
              actions.add({ day: today, minutes: null, allDayRow: false }, { x: r.left, y: r.bottom + 4 })
            }}>
              <span className="row-4px"><Plus size={14} aria-hidden="true" />New</span>
            </button>
          </div>
        </div>

        <div className="cal-body">
          {view === 'month' && <MonthView days={days} month={anchor.month} today={today} weekStart={weekStart} contents={contents} />}
          {view === 'week' && <WeekView days={days} today={today} weekStart={weekStart} contents={contents} entries={answer.entries} now={now} />}
          {view === 'agenda' && <AgendaView days={days} today={today} contents={contents} />}
        </div>

        {open?.kind === 'quick' && (
          <QuickAdd
            at={open.at}
            when={whenText(open.target)}
            workspaces={workspaceList}
            pickWorkspace={allWorkspaces}
            defaultWorkspace={activeWorkspace}
            onAdd={input => addFromCalendar(open.target, input)}
            onClose={() => setOpen(null)}
          />
        )}
        {open?.kind === 'details' && (
          <EntryDetails
            entry={open.entry}
            at={open.at}
            calendarName={open.entry.ref.kind === 'event' ? subscriptions.find(s => s.id === (open.entry.ref as { calendarId: string }).calendarId)?.name ?? null : null}
            onClose={() => setOpen(null)}
            onOpenRepeats={open.entry.ref.kind === 'recurrence' ? () => openRepeats(open.entry) : undefined}
          />
        )}
        {open?.kind === 'day' && (
          <DayList
            title={new Date(open.day.year, open.day.month, open.day.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            entries={dayEntries(open.day)}
            at={open.at}
            onClose={() => setOpen(null)}
          />
        )}
        {open?.kind === 'show' && (
          <ShowMenu at={open.at} layers={layers} problems={answer.problems} onToggle={toggleLayer} onClose={() => setOpen(null)} />
        )}
        {managing && (
          <CalendarsModal
            subscriptions={subscriptions}
            workspaces={workspaceList}
            onChanged={() => { void loadSubscriptions(); void load() }}
            onClose={() => setManaging(false)}
          />
        )}
      </div>
    </CalendarActionsContext.Provider>
  )
}
