import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Item } from '../../../shared/types'
import type { TimerPreset } from '../components/focus/pomodoroTimer'

export type ActiveView = 'log' | 'kanban' | 'backlog' | 'focus' | 'notes' | 'clipboard' | 'cookbook' | 'settings' | 'analytics' | 'cheatsheets' | 'gamedev'

// Merged tab set: Widget lives in General, Kanban in Workspaces & Board,
// Theme Builder in Appearance, Extensions in Features & Plugins.
export type SettingsTab =
  | 'general'
  | 'contexts'
  | 'ai'
  | 'appearance'
  | 'hotkeyBinder'
  | 'features'
  | 'backup'
  | 'storage'
  | 'sync'
  | 'about'

interface AppState {
  // Navigation
  activeView: ActiveView
  // Context
  activeContext: string
  availableContexts: string[]
  // Settings Tab
  settingsTab: SettingsTab
  // Right panel
  rightPanelOpen: boolean
  rightPanelContent: 'item-detail' | 'ai-chat' | 'git' | null
  selectedItemId: string | null
  // Global UI
  isLoading: boolean
  // Preselected task for Pomodoro Navigation
  preselectedTaskId: string | null
  // Game Dev PBR Generator Preload
  gamedevPreloadTexturePath: string | null
  gamedevSourceCardId: string | null
  // Game Dev Seamless Generator Preload
  gamedevPreloadSeamlessPath: string | null
  gamedevSourceSeamlessCardId: string | null

  // Focus Timer Engine (lives here, not in FocusView, so it survives navigation)
  focusStep: 'setup' | 'active' | 'retro'
  focusSelectedTasks: Item[]
  focusPreset: TimerPreset | 'custom'
  focusCustomMinutes: number
  focusDurationMs: number
  focusEndAt: number | null       // timestamp the timer will hit 0 at, while running
  focusRemainingMs: number        // authoritative remaining time while paused/not started
  focusIsRunning: boolean
  focusElapsedMs: number          // total time actually spent running, for stats/log
  focusCyclesCompleted: number    // completed focus intervals since app open (for pomodoro dots)
  focusDistractions: number       // interruptions tallied during the current focus interval

  // Actions
  setView: (view: ActiveView) => void
  setContext: (context: string) => void
  setSettingsTab: (tab: SettingsTab) => void
  toggleRightPanel: (content?: AppState['rightPanelContent']) => void
  setRightPanelContent: (content: 'item-detail' | 'ai-chat' | 'git' | null) => void
  selectItem: (id: string | null) => void
  setAvailableContexts: (contexts: string[]) => void
  setLoading: (loading: boolean) => void
  setPreselectedTaskId: (id: string | null) => void
  setGamedevPreloadTexture: (path: string | null, cardId?: string | null) => void
  setGamedevPreloadSeamless: (path: string | null, cardId?: string | null) => void

  // Focus Timer Actions
  focusSetStep: (step: 'setup' | 'active' | 'retro') => void
  focusSetSelectedTasks: (tasks: Item[] | ((prev: Item[]) => Item[])) => void
  focusSetPreset: (preset: TimerPreset | 'custom') => void
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
}

export const useAppStore = create<AppState>()(
  immer(set => ({
    activeView: 'kanban',
    activeContext: 'default',
    availableContexts: ['default'],
    settingsTab: 'general',
    rightPanelOpen: false,
    rightPanelContent: null,
    selectedItemId: null,
    isLoading: false,
    preselectedTaskId: null,
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

    setView: (view: ActiveView) =>
      set(state => {
        state.activeView = view
      }),

    setContext: (context: string) =>
      set(state => {
        state.activeContext = context
        window.electronAPI.db.setSetting('active_context', context).catch((err) => {
          console.error('Failed to save active_context setting:', err)
        })
      }),

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

    setAvailableContexts: (contexts: string[]) =>
      set(state => {
        state.availableContexts = contexts
      }),

    setLoading: (loading: boolean) =>
      set(state => {
        state.isLoading = loading
      }),

    setPreselectedTaskId: (id: string | null) =>
      set(state => {
        state.preselectedTaskId = id
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

    // Focus Timer Engine
    // Timer state lives in the global store (not component state) so a running
    // session survives navigating to other views. Countdown is timestamp-based
    // (focusEndAt) rather than tick-accumulated, so it can never drift even if
    // the interval driving it is throttled while the window is unfocused.
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
          // Pausing: freeze remaining time, drop the end-timestamp
          const remaining = state.focusEndAt ? Math.max(0, state.focusEndAt - Date.now()) : state.focusRemainingMs
          state.focusRemainingMs = remaining
          state.focusEndAt = null
          state.focusIsRunning = false
        } else {
          // Resuming: recompute the end-timestamp from remaining time
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

    // Called on every tick by the global timer engine hook. Recomputes
    // remaining/elapsed from wall-clock time so drift and throttled
    // background tabs can never desync the displayed time.
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
        if (state.focusPreset === 'focus') {
          state.focusCyclesCompleted += 1
        }
      }),

    // Tally an interruption during the current focus interval. A core Pomodoro
    // practice: acknowledge the distraction, keep working, review the count in
    // the retrospective to spot patterns over time.
    focusLogDistraction: () =>
      set(state => {
        state.focusDistractions += 1
      }),

    // Cancel a running/paused session: stop the clock and return to setup,
    // but keep the chosen tasks selected so the user can just hit start again.
    focusStop: () =>
      set(state => {
        state.focusStep = 'setup'
        state.focusIsRunning = false
        state.focusEndAt = null
        state.focusRemainingMs = state.focusDurationMs
        state.focusElapsedMs = 0
      }),

    // Full reset: used after discarding/saving a retrospective, clears the
    // task selection too so the next session starts from a clean slate.
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