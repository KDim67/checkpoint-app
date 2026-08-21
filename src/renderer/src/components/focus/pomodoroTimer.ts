export type TimerPreset = 'focus' | 'short-break' | 'long-break'

/** What the setup screen can have selected, a preset, or a hand-typed length. */
export type TimerMode = TimerPreset | 'custom'

/**
 * A custom length is still a focus interval; only the two break presets are
 * breaks. Cycle counting keys off this, so treating 'custom' as non-focus meant
 * hand-timed intervals never advanced the four-interval long-break cadence.
 */
export function isFocusInterval(mode: TimerMode): boolean {
  return mode === 'focus' || mode === 'custom'
}

export const MODE_TITLES: Record<TimerMode, string> = {
  focus: 'Focus',
  custom: 'Focus',
  'short-break': 'Short Break',
  'long-break': 'Long Break'
}

export interface TimerPresetConfig {
  label: string
  durationMs: number
}

export const TIMER_PRESETS: Record<TimerPreset, TimerPresetConfig> = {
  focus: { label: 'Focus', durationMs: 25 * 60 * 1000 },
  'short-break': { label: 'Short Break', durationMs: 5 * 60 * 1000 },
  'long-break': { label: 'Long Break', durationMs: 15 * 60 * 1000 }
}

/**
 * Formats a duration in milliseconds to MM:SS string representation.
 */
export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}
