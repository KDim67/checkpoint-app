/** what every chip and cell can ask the calendar for, without threading it through each view */

import { createContext, useContext, type CSSProperties, type DragEvent } from 'react'
import type { CalendarEntry, DropTarget, Nudge } from '../../../../shared/calendar'
import type { CalendarDay } from '../../../../shared/dueDate'

export const DRAG_TYPE = 'application/x-checkpoint-calendar-entry'

export interface CalendarActions {
  open(entry: CalendarEntry, anchor: HTMLElement): void
  /** a day's whole list, when its cell can't show everything */
  showDay(day: CalendarDay, anchor: HTMLElement): void
  add(target: DropTarget, at: { x: number; y: number }): void
  drop(target: DropTarget, event: DragEvent): void
  /** Alt and an arrow key on a movable chip; inTimeGrid moves a timed one by quarter hours up and down */
  nudge(entry: CalendarEntry, nudge: Nudge, inTimeGrid: boolean): void
  colorOf(entry: CalendarEntry): string
  /** the workspace's name, shown on a chip only while every workspace is on screen */
  workspaceLabel(entry: CalendarEntry): string | null
}

export const CalendarActionsContext = createContext<CalendarActions | null>(null)

export function useCalendarActions(): CalendarActions {
  const actions = useContext(CalendarActionsContext)
  if (!actions) throw new Error('A calendar part was rendered outside the calendar.')
  return actions
}

/** positions computed per entry ride in custom properties, so the stylesheet keeps every rule */
export const cssVars = (vars: Record<string, string>): CSSProperties => vars as CSSProperties

/** a drag the calendar started, never a file or text from elsewhere */
export const isEntryDrag = (event: DragEvent): boolean => event.dataTransfer.types.includes(DRAG_TYPE)
