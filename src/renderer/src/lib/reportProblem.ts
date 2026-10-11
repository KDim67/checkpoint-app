/** Report a problem opens from the palette, About, a crash notice or a broken view, so it travels as one window event */

export const REPORT_PROBLEM_EVENT = 'report-problem'

/** what happened is started for the person when the opener already knows it */
export function openProblemReport(what = ''): void {
  window.dispatchEvent(new CustomEvent<string>(REPORT_PROBLEM_EVENT, { detail: what }))
}
