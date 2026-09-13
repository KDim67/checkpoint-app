/** neutral home for shapes the split-out hooks and modals share */

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** from <think> tags */
  thinking?: string
  /** short label shown instead of the full prompt */
  displayContent?: string
  /** from a quick-action button, so keywords can't misclassify it */
  intentHint?: 'create' | 'analyze'
  mode?: string
  cheatsheets?: string[]
  /** from Notes */
  notes?: string[]
  /** relative paths */
  files?: string[]
  /** data URLs for vision models */
  images?: string[]
  timestamp?: number
  boardSnapshot?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columns: any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cards: any[]
  }
}

export interface SavedChat {
  id: string
  title: string
  createdAt: number
  messages: Message[]
}

// in shared/types so preload, main and the panel agree
export type { WorkspaceFileInfo } from '../../../../shared/types'

export interface CustomAction {
  id: string
  label: string
  prompt: string
  intent: 'create' | 'analyze'
}

/** decided before sending */
export type IntentType =
  | 'create_items'
  | 'create_plan'
  | 'create_dialogue'
  | 'update_items'
  | 'configure_board'
  | 'converse'
