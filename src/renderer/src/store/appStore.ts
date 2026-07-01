import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type ActiveView = 'log' | 'kanban' | 'backlog' | 'focus' | 'notes' | 'clipboard' | 'cookbook' | 'settings' | 'analytics' | 'cheatsheets' | 'gamedev'

export type SettingsTab =
  | 'general'
  | 'contexts'
  | 'kanban'
  | 'ai'
  | 'appearance'
  | 'themeCustomizer'
  | 'hotkeyBinder'
  | 'extensions'
  | 'widget'
  | 'features'
  | 'backup'
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
}

export const useAppStore = create<AppState>()(
  immer(set => ({
    activeView: 'log',
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
      })
  }))
)
