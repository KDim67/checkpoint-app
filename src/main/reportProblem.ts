/** the bug report as main knows it, for the window to show and for the crash dialog when there is no window to show it in */

import { app, shell } from 'electron'
import { existsSync } from 'fs'
import { homedir, release } from 'os'
import { appLogPath } from './appLog'
import { tailOf } from './rotatingLog'
import { openExternalSafely } from './openExternal'
import { issueLink, REPORT_LOG_LINES, systemName, withoutHome, type ProblemReport, type ProblemReportDraft } from '../shared/problemReport'
import { redactSecrets } from '../shared/redactSecrets'

/** the home folder as ~ and anything shaped like a key as [redacted]; only main knows the home folder */
export const cleaned = (text: string): string => redactSecrets(withoutHome(text, homedir()))

export function currentReport(): ProblemReport {
  // the file is redacted as it's written; this catches anything that reached it another way
  const log = cleaned(tailOf(appLogPath(), REPORT_LOG_LINES).join('\n'))
  return { version: app.getVersion(), system: systemName(process.platform, release()), log }
}

/** the report with what happened started from what the opener knew, an error message cleaned like the log */
export function reportDraft(seed: string): ProblemReportDraft {
  return { ...currentReport(), what: cleaned(seed) }
}

/** for when the window can't show the report: nobody reads the log here, so it stays out of the link and its file is shown to attach instead */
export function openReport(what: string): void {
  openExternalSafely(issueLink({ ...currentReport(), log: '' }, cleaned(what)).url)
  const file = appLogPath()
  if (existsSync(file)) shell.showItemInFolder(file)
}
