/** Report a problem's dialog, opened by its window event, and the notice when the window just came back from a crash */

import { lazy, Suspense, useEffect, useState } from 'react'
import { useToast } from './ui/Toast'
import { crashNotice } from '../data/app'
import { openProblemReport, REPORT_PROBLEM_EVENT } from '../lib/reportProblem'
import { CRASH_NOTICE_MS } from '../lib/timings'

const ReportProblemDialog = lazy(() => import('./ReportProblemDialog'))

export default function ProblemReporter(): React.JSX.Element | null {
  const { toast } = useToast()
  const [opened, setOpened] = useState<{ what: string } | null>(null)

  useEffect(() => {
    const open = (event: Event): void => {
      const what = (event as CustomEvent<unknown>).detail
      setOpened({ what: typeof what === 'string' ? what : '' })
    }
    window.addEventListener(REPORT_PROBLEM_EVENT, open)
    return () => window.removeEventListener(REPORT_PROBLEM_EVENT, open)
  }, [])

  // main hands the notice over once, so a second effect run in development just gets null
  useEffect(() => {
    crashNotice()
      .then(reason => {
        if (!reason) return
        toast('The window crashed and was reloaded.', {
          type: 'warning',
          duration: CRASH_NOTICE_MS,
          action: { label: 'Report', onClick: () => openProblemReport(`The window crashed (${reason}) and was reloaded.`) }
        })
      })
      .catch(() => {})
  }, [toast])

  if (!opened) return null
  return (
    <Suspense fallback={null}>
      <ReportProblemDialog initialWhat={opened.what} onClose={() => setOpened(null)} />
    </Suspense>
  )
}
