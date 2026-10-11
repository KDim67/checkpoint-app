/** a bug report the person reads and edits first; it leaves only through their own browser, as a prefilled GitHub form */

import { useEffect, useMemo, useState } from 'react'
import ModalShell from './ui/ModalShell'
import { useToast } from './ui/Toast'
import * as appApi from '../data/app'
import { errorMessage } from '../../../shared/errors'
import { issueLink, reportText, type ProblemReport } from '../../../shared/problemReport'
import { redactSecrets } from '../../../shared/redactSecrets'

export default function ReportProblemDialog({ initialWhat = '', onClose }: {
  /** started for the person when whoever opened it already knew */
  initialWhat?: string
  onClose: () => void
}): React.JSX.Element {
  const { toast } = useToast()
  const [facts, setFacts] = useState<Omit<ProblemReport, 'log'> | null>(null)
  const [unreadable, setUnreadable] = useState('')
  // shown only once main has cleaned it, so what's on screen is what would be sent
  const [what, setWhat] = useState('')
  const [log, setLog] = useState('')

  useEffect(() => {
    let cancelled = false
    appApi.problemReport(initialWhat)
      .then(draft => {
        if (cancelled) return
        setFacts({ version: draft.version, system: draft.system })
        setLog(draft.log)
        setWhat(draft.what)
      })
      .catch(err => {
        if (cancelled) return
        // the person can still say what happened and fill the rest in on GitHub
        setFacts({ version: '', system: '' })
        setUnreadable(errorMessage(err))
        setWhat(redactSecrets(initialWhat))
      })
    return () => { cancelled = true }
  }, [initialWhat])

  const report = useMemo(() => (facts ? { ...facts, log } : null), [facts, log])
  const link = useMemo(() => (report ? issueLink(report, what) : null), [report, what])

  const openOnGitHub = (): void => {
    if (!link) return
    void appApi.openExternal(link.url)
    onClose()
  }

  const copy = (): void => {
    if (!report) return
    navigator.clipboard.writeText(reportText(report, what))
      .then(() => toast('Report copied', { type: 'success' }))
      .catch(err => toast(`Could not copy the report: ${errorMessage(err)}`, { type: 'error' }))
  }

  return (
    <ModalShell label="Report a problem" onClose={onClose} width="var(--report-problem-width)">
      <div className="report-problem">
        <h2 className="report-problem-title">Report a problem</h2>
        <p className="report-problem-intro">
          Open on GitHub sends the details below to GitHub as a bug report for you to finish there. It becomes public when you submit it, so read the log first.
        </p>

        {!report ? (
          <p className="report-problem-hint">Reading the app log…</p>
        ) : (
          <>
            {(report.version || report.system) && (
              <dl className="report-problem-facts">
                <div><dt>Version</dt><dd>{report.version}</dd></div>
                <div><dt>System</dt><dd>{report.system}</dd></div>
              </dl>
            )}

            <label className="field-label" htmlFor="report-problem-what">What happened</label>
            <textarea
              id="report-problem-what"
              className="input-base report-problem-what"
              rows={4}
              value={what}
              onChange={event => setWhat(event.target.value)}
              placeholder="What you did, what you expected, and what you got instead"
              autoFocus
            />

            <div className="report-problem-log-head">
              <label className="field-label" htmlFor="report-problem-log">Recent errors</label>
              <button
                type="button"
                className="report-problem-link"
                onClick={() => void appApi.showAppLog().catch(err => toast(`Could not show the app log: ${errorMessage(err)}`, { type: 'error' }))}
              >
                Show app log
              </button>
            </div>
            <textarea
              id="report-problem-log"
              className="input-base report-problem-log"
              rows={8}
              value={log}
              onChange={event => setLog(event.target.value)}
              placeholder={unreadable ? '' : 'Nothing recorded yet.'}
              spellCheck={false}
            />
            <p className="report-problem-hint">
              {unreadable
                ? `The app log couldn't be read: ${unreadable}`
                : 'In the log and in anything filled in for you, your user folder shows as ~ and anything shaped like a key or token as [redacted]. That catches the usual ones, not everything, and what you type is sent as you wrote it.'}
            </p>
            {link?.trimmed && (
              <p className="report-problem-hint report-problem-trimmed">
                Too long for a link, so the oldest lines are left out. Copy report keeps them all.
              </p>
            )}
          </>
        )}

        <div className="report-problem-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-secondary" onClick={copy}>Copy report</button>
          <button type="button" className="btn-primary" onClick={openOnGitHub}>Open on GitHub</button>
        </div>
      </div>
    </ModalShell>
  )
}
