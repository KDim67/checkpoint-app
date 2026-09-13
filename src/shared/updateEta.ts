/** titlebar and About share one estimate so they never disagree */

import type { UpdateProgress } from './types'

/** null with nothing solid to divide by */
export function etaSeconds(progress: UpdateProgress): number | null {
  if (progress.phase !== 'downloading') return null
  const { transferred, total, bytesPerSecond } = progress
  if (!Number.isFinite(total) || !Number.isFinite(transferred)) return null
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null
  const remaining = total - transferred
  return remaining > 0 ? remaining / bytesPerSecond : 0
}

/** coarse, early estimates jump and read as broken */
function round(seconds: number): { value: number; unit: 'sec' | 'min' | 'hour' } {
  // test the rounded figure so the last seconds read "1 min"
  const secs = Math.max(5, Math.ceil(seconds / 5) * 5)
  if (secs < 60) return { value: secs, unit: 'sec' }
  if (seconds < 3600) return { value: Math.ceil(seconds / 60), unit: 'min' }
  return { value: Math.ceil(seconds / 3600), unit: 'hour' }
}

/** empty with no estimate */
export function etaShort(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return ''
  const { value, unit } = round(seconds)
  if (unit === 'hour') return value === 1 ? '1 hour' : `${value} hours`
  return `${value} ${unit}`
}

/** empty with none */
export function etaPhrase(seconds: number | null): string {
  const short = etaShort(seconds)
  return short ? `${short} left` : ''
}

/** installer-sized units */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  const mb = bytes / 1_048_576
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`
  return `${mb.toFixed(1)} MB`
}

/** version and estimate are both conditional early on */
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
