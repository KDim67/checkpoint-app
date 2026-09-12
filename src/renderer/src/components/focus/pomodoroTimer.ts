export type TimerPreset = 'focus' | 'short-break' | 'long-break'

/** What the setup screen can have selected. A preset, or a hand-typed length. */
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

interface TimerPresetConfig {
  label: string
  durationMs: number
}

/** Labels and the classic 25/5/15 lengths, used when nothing has been customised. */
export const TIMER_PRESETS: Record<TimerPreset, TimerPresetConfig> = {
  focus: { label: 'Focus', durationMs: 25 * 60 * 1000 },
  'short-break': { label: 'Short Break', durationMs: 5 * 60 * 1000 },
  'long-break': { label: 'Long Break', durationMs: 15 * 60 * 1000 }
}

export interface FocusSettings {
  /** Interval lengths in minutes, keyed by preset. */
  durations: Record<TimerPreset, number>
  /** Focus intervals between long breaks. 4 is the classic Pomodoro cadence. */
  longBreakInterval: number
  autoStartNext: boolean
  chimeEnabled: boolean
  /** 0–1, applied to the chime's peak gain. */
  chimeVolume: number
  notificationsEnabled: boolean
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  durations: {
    focus: 25,
    'short-break': 5,
    'long-break': 15
  },
  longBreakInterval: 4,
  autoStartNext: false,
  chimeEnabled: true,
  chimeVolume: 0.2,
  notificationsEnabled: true
}

export const FOCUS_SETTING_KEYS: Record<TimerPreset, string> = {
  focus: 'focus_duration_focus',
  'short-break': 'focus_duration_short_break',
  'long-break': 'focus_duration_long_break'
}

/** Guards against a hand-edited settings row producing a zero-length timer. */
export function clampMinutes(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(180, Math.max(1, Math.round(value)))
}

export function durationMsFor(settings: FocusSettings, preset: TimerPreset): number {
  return settings.durations[preset] * 60 * 1000
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
