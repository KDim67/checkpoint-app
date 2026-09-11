/**
 * How much of an update is left, and how to say it.
 *
 * Pure and shared because two surfaces show the same download: the titlebar
 * indicator, which has room for two words, and the About panel, which has room
 * for the sentence. They must never disagree about how long is left, so both
 * round through the same function.
 */

import type { UpdateProgress } from './types'

/** Seconds remaining, or null when there is nothing solid to divide by. */
export function etaSeconds(progress: UpdateProgress): number | null {
  if (progress.phase !== 'downloading') return null
  const { transferred, total, bytesPerSecond } = progress
  if (!Number.isFinite(total) || !Number.isFinite(transferred)) return null
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null
  const remaining = total - transferred
  return remaining > 0 ? remaining / bytesPerSecond : 0
}

/**
 * Rounded coarsely on purpose. The opening seconds of a download produce wild
 * estimates, and a figure that jumps 4:31, 2:08, 3:47 reads as broken even when
 * the download is perfectly healthy.
 */
function round(seconds: number): { value: number; unit: 'sec' | 'min' | 'hour' } {
  // Tested against the rounded figure, not the raw one, so the last few seconds
  // of the minute read as "1 min" rather than "60 sec".
  const secs = Math.max(5, Math.ceil(seconds / 5) * 5)
  if (secs < 60) return { value: secs, unit: 'sec' }
  if (seconds < 3600) return { value: Math.ceil(seconds / 60), unit: 'min' }
  return { value: Math.ceil(seconds / 3600), unit: 'hour' }
}

/** "40 sec", "2 min", "2 hours". Empty when there is no estimate to give. */
export function etaShort(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return ''
  const { value, unit } = round(seconds)
  if (unit === 'hour') return value === 1 ? '1 hour' : `${value} hours`
  return `${value} ${unit}`
}

/** The same estimate with the sentence finished. Empty when there is none. */
export function etaPhrase(seconds: number | null): string {
  const short = etaShort(seconds)
  return short ? `${short} left` : ''
}

/** "980 KB", "12.4 MB". Sizes an installer actually comes in. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  const mb = bytes / 1_048_576
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`
  return `${mb.toFixed(1)} MB`
}

/**
 * The whole story, for the About panel and for the indicator's tooltip.
 *
 * Everything after the percentage is conditional: the version is unknown if the
 * download started before the event naming it arrived, and the estimate is
 * unknown for the first second or two of every download.
 */
export function describeUpdateProgress(progress: UpdateProgress): string {
  if (progress.phase === 'ready') {
    return `Version ${progress.version} is ready. It installs the next time you close Checkpoint.`
  }
  const named = progress.version ? ` version ${progress.version}` : ''
  const size = progress.total > 0
    ? ` ${formatBytes(progress.transferred)} of ${formatBytes(progress.total)}.`
    : ''
  const left = etaPhrase(etaSeconds(progress))
  return `Downloading${named}, ${progress.percent}%.${size}${left ? ` ${left}.` : ''}`
}
