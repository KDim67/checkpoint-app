/** every screen and side panel, loaded on first use and fetched ahead in quiet moments so a first visit opens like any other */

import type { ActiveView } from '../store/appStore'
import { lazyView } from '../lib/lazyView'
import { readViewFeatures, VIEW_FEATURES } from '../lib/features'
import { SCREEN_PRELOAD_DELAY_MS } from '../lib/timings'

export const LogView = lazyView(() => import('./LogView'))
export const KanbanView = lazyView(() => import('./KanbanView'))
export const BacklogView = lazyView(() => import('./BacklogView'))
export const RenewalsView = lazyView(() => import('./RenewalsView'))
export const CalendarView = lazyView(() => import('./CalendarView'))
export const CookbookView = lazyView(() => import('./CookbookView'))
export const WallView = lazyView(() => import('./wall/WallView'))
export const SettingsView = lazyView(() => import('./SettingsView'))
export const WorkspacesView = lazyView(() => import('./workspaces/WorkspacesView'))
export const FocusView = lazyView(() => import('./FocusView'))
export const NotesView = lazyView(() => import('./NotesView'))
export const ClipboardView = lazyView(() => import('./ClipboardView'))
export const AnalyticsView = lazyView(() => import('./AnalyticsView'))
export const CheatsheetsView = lazyView(() => import('./CheatsheetsView'))
export const GameDevView = lazyView(() => import('./GameDevView'))

// lazy: eager imports pulled ~7,000 lines into every startup, panel open or not
export const AiStreamPanel = lazyView(() => import('./AiStreamPanel'))
export const GitPanel = lazyView(() => import('./GitPanel'))
export const ItemDetailPanel = lazyView(() => import('./ItemDetailPanel'))

const SCREENS: Record<ActiveView, { preload: () => Promise<void> }> = {
  log: LogView,
  kanban: KanbanView,
  backlog: BacklogView,
  renewals: RenewalsView,
  calendar: CalendarView,
  cookbook: CookbookView,
  wall: WallView,
  settings: SettingsView,
  workspaces: WorkspacesView,
  focus: FocusView,
  notes: NotesView,
  clipboard: ClipboardView,
  analytics: AnalyticsView,
  cheatsheets: CheatsheetsView,
  gamedev: GameDevView
}

/** as a pointer or the keyboard reaches its button, ahead of the click */
export function preloadScreen(view: ActiveView): void {
  void SCREENS[view].preload()
}

const whenIdle = (run: () => void): void => {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run, 50)
}

/** after the first screen is up, the switched-on screens in the sidebar's order, then Settings, Workspaces and a card's details; one per idle moment */
export function preloadScreensWhenIdle(): () => void {
  let stopped = false
  const timer = setTimeout(() => {
    void readViewFeatures().then(enabled => {
      const queue = [
        ...VIEW_FEATURES.filter(f => enabled[f.view]).map(f => SCREENS[f.view]),
        SettingsView,
        WorkspacesView,
        ItemDetailPanel
      ]
      const next = (): void => {
        const screen = queue.shift()
        if (!screen || stopped) return
        whenIdle(() => {
          if (!stopped) void screen.preload().then(next)
        })
      }
      next()
    }).catch(() => {})
  }, SCREEN_PRELOAD_DELAY_MS)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
