/** a bug report as GitHub's issue form takes it: version, system, what happened and the recent log, read by the person before it leaves */

import { REPOSITORY } from './releaseNotes'

/** the form in .github/ISSUE_TEMPLATE; its field ids are what a link can fill */
export const BUG_REPORT_FORM = `${REPOSITORY}/issues/new`
const TEMPLATE = 'bug_report.yml'

/** GitHub answers a longer link with an error, so the log gives way from its oldest end */
export const MAX_ISSUE_URL = 8000

/** recent enough to hold what just went wrong, short enough to read before sending */
export const REPORT_LOG_LINES = 50

export interface ProblemReport {
  version: string
  system: string
  /** recent app log lines, with the home folder shown as ~ */
  log: string
}

/** the report as the dialog opens on it, what happened already started and cleaned like the log */
export interface ProblemReportDraft extends ProblemReport {
  what: string
}

/** what the window sends the app log when it fails on its own */
export interface WindowError {
  source: 'render' | 'error' | 'rejection'
  message: string
  stack?: string
  componentStack?: string
}

/** windows 11 still calls itself 10.0, only the build number tells them apart */
export function windowsName(release: string): string {
  const build = Number(release.split('.')[2])
  if (!release.startsWith('10.') || !Number.isInteger(build)) return `Windows ${release}`
  return `Windows ${build >= 22000 ? 11 : 10} (build ${build})`
}

export function systemName(platform: string, release: string): string {
  if (platform === 'win32') return windowsName(release)
  if (platform === 'darwin') return `macOS (Darwin ${release})`
  return `${platform === 'linux' ? 'Linux' : platform} ${release}`
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** the home folder carries the account name into a public issue; caught in any slash style or case, and inside file URLs */
export function withoutHome(text: string, home: string): string {
  const trimmed = home.replace(/[\\/]+$/, '')
  if (!trimmed) return text
  let out = text
  for (const form of new Set([trimmed, encodeURI(trimmed.replace(/\\/g, '/'))])) {
    const pattern = form.split(/[\\/]+/).map(escapeRegex).join('[\\\\/]+')
    // the whole folder only, not a longer name that starts the same
    out = out.replace(new RegExp(`${pattern}(?![\\w.-])`, 'gi'), '~')
  }
  return out
}

/** cut by characters, never through the middle of one, which encodeURIComponent would throw on */
const firstChars = (text: string, count: number): string => Array.from(text).slice(0, Math.max(0, count)).join('')

/** the issue's title, from the first line of what happened */
export function issueTitle(what: string): string {
  const line = what.trim().split('\n')[0].trim()
  return Array.from(line).length > 80 ? `${firstChars(line, 79)}…` : line
}

/** spaces as %20, which every reader takes as a space, where + is only a space to some */
const query = (fields: Record<string, string>): string =>
  Object.entries(fields)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

/** the largest count in 0..most whose link fits, given that fewer always makes it shorter; 0 when nothing does */
function largestFitting(most: number, fits: (count: number) => boolean): number {
  let low = 0
  let high = most
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(middle)) low = middle
    else high = middle - 1
  }
  return low
}

/** the prefilled form; the log loses lines from its oldest end until the link fits, then what happened is cut */
export function issueLink(report: ProblemReport, what: string, max = MAX_ISSUE_URL): { url: string; trimmed: boolean } {
  const link = (log: string, text: string): string =>
    `${BUG_REPORT_FORM}?${query({ template: TEMPLATE, title: issueTitle(text), version: report.version, os: report.system, what: text, console: log })}`
  const text = what.trim()
  const lines = report.log === '' ? [] : report.log.split('\n')
  const newest = (count: number): string => lines.slice(lines.length - count).join('\n')

  const whole = link(report.log, text)
  if (whole.length <= max) return { url: whole, trimmed: false }
  const keptLines = largestFitting(lines.length, count => link(newest(count), text).length <= max)
  if (keptLines > 0 || link('', text).length <= max) return { url: link(newest(keptLines), text), trimmed: true }

  // no log left and still too long: what happened gives way too
  const chars = Array.from(text)
  const keptChars = largestFitting(chars.length, count => link('', chars.slice(0, count).join('')).length <= max)
  return { url: link('', chars.slice(0, keptChars).join('')), trimmed: true }
}

/** the whole report as text for pasting anywhere, nothing left out */
export function reportText(report: ProblemReport, what: string): string {
  return [
    `Checkpoint ${report.version} on ${report.system}`,
    '',
    'What happened:',
    what.trim() || '(not filled in)',
    '',
    'Recent app log:',
    report.log || '(nothing recorded)'
  ].join('\n')
}
