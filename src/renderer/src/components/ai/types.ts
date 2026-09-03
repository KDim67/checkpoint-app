/**
 * Shapes shared by the assistant panel and the pieces split out of it.
 *
 * These lived inside AiStreamPanel.tsx, which meant every hook or modal
 * extracted from it had to either re-declare them or import from a 3,600-line
 * component. They are here so the split has somewhere neutral to point at.
 */

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Chain-of-thought extracted from <think>…</think> tags (reasoning models). */
  thinking?: string
  /** Optional concise label shown in the bubble instead of the full prompt (quick actions). */
  displayContent?: string
  /** Explicit intent from a quick-action button, so it can't be mis-classified by keywords. */
  intentHint?: 'create' | 'analyze'
  mode?: string
  cheatsheets?: string[]
  /** Attached note titles (from the Notes feature). */
  notes?: string[]
  /** Attached workspace file relative paths. */
  files?: string[]
  /** Attached images as data URLs (vision models). */
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

export interface WorkspaceFileInfo {
  name: string
  relativePath: string
  extension: string
  size: number
}

export interface CustomAction {
  id: string
  label: string
  prompt: string
  intent: 'create' | 'analyze'
}

/** What the model should do with a message, decided before it is sent. */
export type IntentType =
  | 'create_items'
  | 'create_plan'
  | 'create_dialogue'
  | 'update_items'
  | 'configure_board'
  | 'converse'
