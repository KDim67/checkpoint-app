import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type ActiveView = 'log' | 'kanban' | 'backlog' | 'cookbook' | 'settings'

interface AppState {
  // Navigation
  activeView: ActiveView
  // Context
  activeContext: string
  availableContexts: string[]
  // Right panel
  rightPanelOpen: boolean
  rightPanelContent: 'item-detail' | 'ai-chat' | null
  selectedItemId: string | null
  // Global UI
  isLoading: boolean

  // Actions
  setView: (view: ActiveView) => void
  setContext: (context: string) => void
  toggleRightPanel: (content?: AppState['rightPanelContent']) => void
  selectItem: (id: string | null) => void
  setAvailableContexts: (contexts: string[]) => void
  setLoading: (loading: boolean) => void
}

export const useAppStore = create<AppState>()(
  immer(set => ({
    activeView: 'log',
    activeContext: 'default',
    availableContexts: ['default'],
    rightPanelOpen: false,
    rightPanelContent: null,
    selectedItemId: null,
    isLoading: false,

    setView: (view: ActiveView) =>
      set(state => {
        state.activeView = view
      }),

    setContext: (context: string) =>
      set(state => {
        state.activeContext = context
      }),

    toggleRightPanel: (content?: AppState['rightPanelContent']) =>
      set(state => {
        if (content && state.rightPanelContent === content && state.rightPanelOpen) {
          state.rightPanelOpen = false
          state.rightPanelContent = null
        } else {
          state.rightPanelOpen = true
          state.rightPanelContent = content ?? 'ai-chat'
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
      })
  }))
)
