export type TimerPreset = 'focus' | 'short-break' | 'long-break'

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
