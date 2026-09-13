import type { ActiveView } from '../store/appStore'
import { getBoolSetting, setBoolSetting, getStringSetting } from './settings'

/** sidebar order; three hand-kept copies drifted apart */
interface ViewFeature {
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
  // the only view off by default, it records every copy
  { view: 'clipboard',   key: 'feature_view_clipboard',   label: 'Clipboard History Vault',  defaultOn: false },
  { view: 'analytics',   key: 'feature_view_analytics',   label: 'Time & App Analytics',     defaultOn: true },
  { view: 'cookbook',    key: 'feature_view_cookbook',    label: 'AI Assistant Cookbook',    defaultOn: true },
  { view: 'cheatsheets', key: 'feature_view_cheatsheets', label: 'Quick Cheatsheets & PDFs', defaultOn: true },
  { view: 'gamedev',     key: 'feature_gamedev_helpers',  label: 'Game Development Helpers', defaultOn: false }
]

/** off means no model calls at all; nothing is deleted */
export const AI_FEATURE_KEY = 'feature_ai'

export async function readAiEnabled(): Promise<boolean> {
  return getBoolSetting(AI_FEATURE_KEY, true)
}

export async function setAiEnabled(enabled: boolean): Promise<void> {
  await setBoolSetting(AI_FEATURE_KEY, enabled)
  window.dispatchEvent(new CustomEvent('settings-update-features'))
}

export type ViewEnabledMap = Record<ActiveView, boolean>

/** the Cookbook follows the AI switch */
export function applyAiGate(map: ViewEnabledMap, aiEnabled: boolean): ViewEnabledMap {
  return aiEnabled ? map : { ...map, cookbook: false }
}

/** optimistic default so nav never flickers */
export function defaultViewEnabledMap(): ViewEnabledMap {
  const map = {} as ViewEnabledMap
  for (const f of VIEW_FEATURES) map[f.view] = f.defaultOn
  map.settings = true
  return map
}

export async function readViewFeatures(): Promise<ViewEnabledMap> {
  const [entries, aiEnabled] = await Promise.all([
    Promise.all(VIEW_FEATURES.map(async f => [f.view, await getBoolSetting(f.key, f.defaultOn)] as const)),
    readAiEnabled()
  ])
  const map = Object.fromEntries(entries) as ViewEnabledMap
  // settings has no flag, it's where you turn the others off
  map.settings = true
  return applyAiGate(map, aiEnabled)
}

export async function setViewFeature(key: string, enabled: boolean): Promise<void> {
  await setBoolSetting(key, enabled)
  window.dispatchEvent(new CustomEvent('settings-update-features'))
}

/** where to land when the current view is disabled */
export function firstEnabledView(enabled: ViewEnabledMap): ActiveView {
  return VIEW_FEATURES.find(f => enabled[f.view])?.view ?? 'settings'
}

export const START_VIEW_LAST_USED = 'last'

/** 'last' replays the last view; always checked against the flags */
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
