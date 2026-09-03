import type { ActiveView } from '../store/appStore'
import { getBoolSetting, setBoolSetting, getStringSetting } from './settings'

/**
 * The per-view feature flags, in sidebar order.
 *
 * This list used to be maintained by hand in three places, App's redirect
 * guard, the Sidebar, and the settings toggle center, which is how
 * gamedev_helpers ended up with a different setting-key shape and a different
 * default from every other view.
 */
export interface ViewFeature {
  view: ActiveView
  key: string
  label: string
  defaultOn: boolean
}

export const VIEW_FEATURES: ViewFeature[] = [
  { view: 'kanban',      key: 'feature_view_kanban',      label: 'Kanban Board View',        defaultOn: true },
  { view: 'log',         key: 'feature_view_log',         label: 'Daily Log View',           defaultOn: true },
  { view: 'backlog',     key: 'feature_view_backlog',     label: 'Structured Backlog View',  defaultOn: true },
  { view: 'focus',       key: 'feature_view_focus',       label: 'Focus Timer & Pomodoro',   defaultOn: true },
  { view: 'notes',       key: 'feature_view_notes',       label: 'Obsidian-Style Notes',     defaultOn: true },
  { view: 'wall',        key: 'feature_view_wall',        label: 'Wall (freeform canvas)',   defaultOn: true },
  { view: 'clipboard',   key: 'feature_view_clipboard',   label: 'Clipboard History Vault',  defaultOn: true },
  { view: 'analytics',   key: 'feature_view_analytics',   label: 'Time & App Analytics',     defaultOn: true },
  { view: 'cookbook',    key: 'feature_view_cookbook',    label: 'AI Assistant Cookbook',    defaultOn: true },
  { view: 'cheatsheets', key: 'feature_view_cheatsheets', label: 'Quick Cheatsheets & PDFs', defaultOn: true },
  { view: 'gamedev',     key: 'feature_gamedev_helpers',  label: 'Game Development Helpers', defaultOn: false }
]

export type ViewEnabledMap = Record<ActiveView, boolean>

/** Optimistic default used before the first read resolves, so nav never flickers. */
export function defaultViewEnabledMap(): ViewEnabledMap {
  const map = {} as ViewEnabledMap
  for (const f of VIEW_FEATURES) map[f.view] = f.defaultOn
  map.settings = true
  return map
}

export async function readViewFeatures(): Promise<ViewEnabledMap> {
  const entries = await Promise.all(
    VIEW_FEATURES.map(async f => [f.view, await getBoolSetting(f.key, f.defaultOn)] as const)
  )
  const map = Object.fromEntries(entries) as ViewEnabledMap
  // Settings has no flag, it is the screen you turn the others off from.
  map.settings = true
  return map
}

export async function setViewFeature(key: string, enabled: boolean): Promise<void> {
  await setBoolSetting(key, enabled)
  window.dispatchEvent(new CustomEvent('settings-update-features'))
}

/** First enabled view in sidebar order, where to land when the current one is disabled. */
export function firstEnabledView(enabled: ViewEnabledMap): ActiveView {
  return VIEW_FEATURES.find(f => enabled[f.view])?.view ?? 'settings'
}

export const START_VIEW_LAST_USED = 'last'

/**
 * Which view to land on at launch. 'last' replays the last view the user was
 * on; anything else is a pinned choice. Either way the result is checked
 * against the feature flags, so a disabled view can never be the landing spot.
 */
export async function resolveStartView(): Promise<ActiveView | null> {
  const [preference, lastView, enabled] = await Promise.all([
    getStringSetting('start_view', START_VIEW_LAST_USED),
    getStringSetting('last_active_view', ''),
    readViewFeatures()
  ])

  const wanted = preference === START_VIEW_LAST_USED ? lastView : preference
  const known = VIEW_FEATURES.find(f => f.view === wanted)
  if (known && enabled[known.view]) return known.view
  return firstEnabledView(enabled)
}
