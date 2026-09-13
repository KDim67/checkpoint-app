import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Item } from '../../../shared/types'
import {
  isFocusInterval,
  DEFAULT_FOCUS_SETTINGS,
  type TimerMode,
  type FocusSettings
} from '../components/focus/pomodoroTimer'

export type ActiveView = 'log' | 'kanban' | 'backlog' | 'focus' | 'notes' | 'wall' | 'clipboard' | 'cookbook' | 'settings' | 'analytics' | 'cheatsheets' | 'gamedev'

/** type-only, so no runtime cycle back into lib */
export type { WorkspaceEntry } from '../lib/createWorkspace'
import type { WorkspaceEntry } from '../lib/createWorkspace'
import { setStringSetting } from '../lib/settings'

// merged tabs: Widget in General, Kanban in Workspaces, Theme Builder in Appearance, Extensions in Features
export type SettingsTab =
  | 'general'
  | 'workspaces'
  | 'ai'
  | 'appearance'
  | 'hotkeyBinder'
  | 'features'
  | 'backup'
  | 'notifications'
  | 'storage'
  | 'sync'
  | 'mcp'
  | 'about'

/** workspace above the storage line, context at and below: the column, keys, IPC and payloads are contracts */
interface AppState {
  activeView: ActiveView
  activeWorkspace: string
  availableWorkspaces: string[]
  workspaceList: WorkspaceEntry[]
  settingsTab: SettingsTab
  rightPanelOpen: boolean
  rightPanelContent: 'item-detail' | 'ai-chat' | 'git' | null
  selectedItemId: string | null
  // preselected task for the pomodoro
  preselectedTaskId: string | null
  /** consumed and cleared by NotesView on mount */
  pendingNoteTitle: string | null
  /** consumed and cleared by BacklogView */
  pendingViewId: string | null
  // PBR generator preload
  gamedevPreloadTexturePath: string | null
  gamedevSourceCardId: string | null
  // seamless generator preload
  gamedevPreloadSeamlessPath: string | null
  gamedevSourceSeamlessCardId: string | null

  // focus timer lives here so it survives navigation
  focusStep: 'setup' | 'active' | 'retro'
  focusSelectedTasks: Item[]
  focusPreset: TimerMode
  focusCustomMinutes: number
  focusDurationMs: number
  focusEndAt: number | null       // when the timer hits 0, while running
  focusRemainingMs: number        // remaining while paused or not started
  focusIsRunning: boolean
  focusElapsedMs: number          // time actually run, for stats
  focusCyclesCompleted: number    // focus intervals since launch, for the dots
  focusDistractions: number       // interruptions this interval
  focusSettings: FocusSettings    // lengths, cadence, chime, notifications

  setView: (view: ActiveView) => void
  setWorkspace: (slug: string) => void
  setSettingsTab: (tab: SettingsTab) => void
  toggleRightPanel: (content?: AppState['rightPanelContent']) => void
  setRightPanelContent: (content: 'item-detail' | 'ai-chat' | 'git' | null) => void
  selectItem: (id: string | null) => void
  setAvailableWorkspaces: (slugs: string[]) => void
  setWorkspaceList: (list: WorkspaceEntry[]) => void
  setPreselectedTaskId: (id: string | null) => void
  setPendingNoteTitle: (title: string | null) => void
  setPendingViewId: (id: string | null) => void
  setGamedevPreloadTexture: (path: string | null, cardId?: string | null) => void
  setGamedevPreloadSeamless: (path: string | null, cardId?: string | null) => void

  focusSetStep: (step: 'setup' | 'active' | 'retro') => void
  focusSetSelectedTasks: (tasks: Item[] | ((prev: Item[]) => Item[])) => void
  focusSetPreset: (preset: TimerMode) => void
  focusSetCustomMinutes: (minutes: number) => void
  focusConfigureDuration: (ms: number) => void
  focusStart: (durationMs: number) => void
  focusPauseResume: () => void
  focusReset: () => void
  focusTick: () => void
  focusFinish: () => void
  focusLogDistraction: () => void
  focusStop: () => void
  focusExitToSetup: () => void
  focusApplySettings: (settings: FocusSettings) => void
}

export const useAppStore = create<AppState>()(
  immer(set => ({
    activeView: 'kanban',
    activeWorkspace: 'default',
    availableWorkspaces: ['default'],
    workspaceList: [],
    settingsTab: 'general',
    rightPanelOpen: false,
    rightPanelContent: null,
    selectedItemId: null,
    preselectedTaskId: null,
    pendingNoteTitle: null,
    pendingViewId: null,
    gamedevPreloadTexturePath: null,
    gamedevSourceCardId: null,
    gamedevPreloadSeamlessPath: null,
    gamedevSourceSeamlessCardId: null,

    focusStep: 'setup',
    focusSelectedTasks: [],
    focusPreset: 'focus',
    focusCustomMinutes: 25,
    focusDurationMs: 25 * 60 * 1000,
    focusEndAt: null,
    focusRemainingMs: 25 * 60 * 1000,
    focusIsRunning: false,
    focusElapsedMs: 0,
    focusCyclesCompleted: 0,
    focusDistractions: 0,
    focusSettings: DEFAULT_FOCUS_SETTINGS,

    setView: (view: ActiveView) => {
      set(state => {
        state.activeView = view
      })
      // for "Start on: Last used"; never Settings
      if (view !== 'settings') {
        setStringSetting('last_active_view', view).catch(err => {
          console.error('Failed to save last_active_view setting:', err)
        })
      }
    },

    setWorkspace: (slug: string) => {
      set(state => {
        state.activeWorkspace = slug
      })
      setStringSetting('active_context', slug).catch((err) => {
        console.error('Failed to save active_context setting:', err)
      })
    },

    setSettingsTab: (tab: SettingsTab) =>
      set(state => {
        state.settingsTab = tab
      }),

    toggleRightPanel: (content?: AppState['rightPanelContent']) =>
      set(state => {
        if (content) {
          if (state.rightPanelContent === content && state.rightPanelOpen) {
            state.rightPanelOpen = false
            state.rightPanelContent = null
          } else {
            state.rightPanelOpen = true
            state.rightPanelContent = content
          }
        } else {
          state.rightPanelOpen = !state.rightPanelOpen
          if (!state.rightPanelOpen) {
            state.rightPanelContent = null
          } else if (!state.rightPanelContent) {
            state.rightPanelContent = 'ai-chat'
          }
        }
      }),

    setRightPanelContent: (content: 'item-detail' | 'ai-chat' | 'git' | null) =>
      set(state => {
        state.rightPanelContent = content
        if (content === null) {
          state.rightPanelOpen = false
        } else {
          state.rightPanelOpen = true
        }
      }),

    selectItem: (id: string | null) =>
      set(state => {
        state.selectedItemId = id
        if (id) {
          state.rightPanelOpen = true
          state.rightPanelContent = 'item-detail'
        }
      }),

    setAvailableWorkspaces: (slugs: string[]) =>
      set(state => {
        state.availableWorkspaces = slugs
      }),

    setWorkspaceList: (list: WorkspaceEntry[]) =>
      set(state => {
        state.workspaceList = list
      }),

    setPreselectedTaskId: (id: string | null) =>
      set(state => {
        state.preselectedTaskId = id
      }),

    setPendingNoteTitle: (title: string | null) =>
      set(state => {
        state.pendingNoteTitle = title
      }),

    setPendingViewId: (id: string | null) =>
      set(state => {
        state.pendingViewId = id
      }),

    setGamedevPreloadTexture: (path: string | null, cardId: string | null = null) =>
      set(state => {
        state.gamedevPreloadTexturePath = path
        state.gamedevSourceCardId = cardId
      }),

    setGamedevPreloadSeamless: (path: string | null, cardId: string | null = null) =>
      set(state => {
        state.gamedevPreloadSeamlessPath = path
        state.gamedevSourceSeamlessCardId = cardId
      }),

    // timestamp-based, so throttled background timers can't drift it
    focusSetStep: step =>
      set(state => {
        state.focusStep = step
      }),

    focusSetSelectedTasks: tasks =>
      set(state => {
        state.focusSelectedTasks =
          typeof tasks === 'function' ? tasks(state.focusSelectedTasks) : tasks
      }),

    focusSetPreset: preset =>
      set(state => {
        state.focusPreset = preset
      }),

    focusSetCustomMinutes: minutes =>
      set(state => {
        state.focusCustomMinutes = minutes
      }),

    focusConfigureDuration: ms =>
      set(state => {
        state.focusDurationMs = ms
        state.focusRemainingMs = ms
      }),

    focusStart: durationMs =>
      set(state => {
        state.focusDurationMs = durationMs
        state.focusRemainingMs = durationMs
        state.focusElapsedMs = 0
        state.focusDistractions = 0
        state.focusEndAt = Date.now() + durationMs
        state.focusIsRunning = true
        state.focusStep = 'active'
      }),

    focusPauseResume: () =>
      set(state => {
        if (state.focusIsRunning) {
          // pausing: freeze remaining, drop the end stamp
          const remaining = state.focusEndAt ? Math.max(0, state.focusEndAt - Date.now()) : state.focusRemainingMs
          state.focusRemainingMs = remaining
          state.focusEndAt = null
          state.focusIsRunning = false
        } else {
          // resuming: new end stamp from remaining
          state.focusEndAt = Date.now() + state.focusRemainingMs
          state.focusIsRunning = true
        }
      }),

    focusReset: () =>
      set(state => {
        state.focusIsRunning = false
        state.focusEndAt = null
        state.focusRemainingMs = state.focusDurationMs
        state.focusElapsedMs = 0
      }),

    // recomputed from wall-clock time each tick
    focusTick: () =>
      set(state => {
        if (!state.focusIsRunning || state.focusEndAt === null) return
        const remaining = Math.max(0, state.focusEndAt - Date.now())
        state.focusRemainingMs = remaining
        state.focusElapsedMs = Math.max(0, state.focusDurationMs - remaining)
      }),

    focusFinish: () =>
      set(state => {
        state.focusIsRunning = false
        state.focusEndAt = null
        state.focusRemainingMs = 0
        state.focusElapsedMs = state.focusDurationMs
        if (isFocusInterval(state.focusPreset)) {
          state.focusCyclesCompleted += 1
        }
      }),

    // tallied for the retro
    focusLogDistraction: () =>
      set(state => {
        state.focusDistractions += 1
      }),

    // back to setup, tasks stay selected
    focusStop: () =>
      set(state => {
        state.focusStep = 'setup'
        state.focusIsRunning = false
        state.focusEndAt = null
        state.focusRemainingMs = state.focusDurationMs
        state.focusElapsedMs = 0
      }),

    // a running session keeps its length, changes apply next interval
    focusApplySettings: (settings: FocusSettings) =>
      set(state => {
        state.focusSettings = settings
        if (!state.focusIsRunning && state.focusStep === 'setup' && state.focusPreset !== 'custom') {
          const ms = settings.durations[state.focusPreset] * 60 * 1000
          state.focusDurationMs = ms
          state.focusRemainingMs = ms
        }
      }),

    // full reset, clears the task selection too
    focusExitToSetup: () =>
      set(state => {
        state.focusStep = 'setup'
        state.focusIsRunning = false
        state.focusEndAt = null
        state.focusSelectedTasks = []
        state.focusRemainingMs = state.focusDurationMs
        state.focusElapsedMs = 0
      })
  }))
)