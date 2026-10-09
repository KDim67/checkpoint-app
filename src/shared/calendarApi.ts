/** what the calendar screen and main say to each other */

import type { CalendarAnswer, CalendarQuery } from './calendar'
import type { Item } from './types'

export type CalendarResult<T> = { ok: true; value: T } | { ok: false; reason: string }

/** what the screen sees of a subscription: its host, never its link */
export interface CalendarSubscription {
  id: string
  name: string
  color: string
  /** null shows it in every workspace */
  workspace: string | null
  host: string
  lastOk: number | null
  error: string | null
}

export interface SubscriptionInput {
  name: string
  url: string
  color: string
  workspace: string | null
}

export interface QuickAddInput {
  context: string
  type: 'card' | 'task'
  title: string
  due: number
}

export interface CalendarBridge {
  entries(query: CalendarQuery): Promise<CalendarResult<CalendarAnswer>>
  /** the due date only; the board's own write, so everything that follows a move follows this one */
  move(itemId: string, due: number): Promise<CalendarResult<{ item: Item; previous: number | null }>>
  quickAdd(input: QuickAddInput): Promise<CalendarResult<Item>>
  subscriptions(): Promise<CalendarResult<CalendarSubscription[]>>
  subscribe(input: SubscriptionInput): Promise<CalendarResult<{ subscription: CalendarSubscription; events: number }>>
  updateSubscription(id: string, patch: Partial<Pick<SubscriptionInput, 'name' | 'color' | 'workspace'>>): Promise<CalendarResult<true>>
  unsubscribe(id: string): Promise<CalendarResult<true>>
  /** force fetches every calendar; otherwise only those older than the given age */
  refresh(force: boolean, olderThanMs?: number): Promise<CalendarResult<boolean>>
  onChanged(callback: () => void): () => void
}
