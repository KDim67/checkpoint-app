import React from 'react'
import { ChevronUp, ChevronDown, Minus } from 'lucide-react'

/**
 * Priority is stored as 0–3 on the item. Everything that renders it reads from
 * here so the numbers, names and colours cannot drift apart per view.
 */
export const PRIORITY_LEVELS = [3, 2, 1, 0] as const

/** Inline form, for chips and menu rows where the surrounding context says "priority". */
export const PRIORITY_LABELS: Record<number, string> = {
  3: 'High',
  2: 'Medium',
  1: 'Low',
  0: 'None'
}

/** Standalone form, for group headers that have to carry the noun themselves. */
export const PRIORITY_LABELS_LONG: Record<number, string> = {
  3: 'High Priority',
  2: 'Medium Priority',
  1: 'Low Priority',
  0: 'No Priority'
}

export const PRIORITY_ICONS: Record<number, React.ReactNode> = {
  3: <ChevronUp size={14} style={{ color: 'var(--color-priority-high)' }} />,
  2: <ChevronUp size={14} style={{ color: 'var(--color-priority-med)' }} />,
  1: <ChevronDown size={14} style={{ color: 'var(--color-priority-low)' }} />,
  0: <Minus size={14} className="text-faint" />
}

/** Kanban's card accent: a bar colour plus the wash behind the priority chip. */
export const PRIORITY_COLORS: Record<number, { bar: string; label: string; bg: string }> = {
  3: { bar: 'var(--color-priority-high)', label: 'High', bg: 'rgba(239,68,68,0.08)' },
  2: { bar: 'var(--color-priority-med)',  label: 'Med',  bg: 'rgba(234,179,8,0.12)' },
  1: { bar: 'var(--color-priority-low)',  label: 'Low',  bg: 'rgba(59,130,246,0.08)' },
  0: { bar: 'transparent', label: '', bg: 'transparent' }
}
