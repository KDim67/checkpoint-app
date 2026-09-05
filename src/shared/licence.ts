/**
 * The copyright line, in one place.
 *
 * It used to be typed into the About panel, where it said 2025 for a project
 * whose first commit is from 2026 and named a different holder from the one in
 * LICENSE. Two copies of a fact is one copy too many when neither is checked.
 *
 * Keep this in step with the LICENSE file: that is the operative document and
 * this only describes it. A test checks that they still agree.
 */

/** The year of the first release. Not the first commit, and never moves. */
export const COPYRIGHT_FROM = 2026

/** As written in LICENSE. */
export const COPYRIGHT_HOLDER = 'Dimitrios Koutsompinas'

/**
 * "2026", or "2026-2028" once there is a range to show.
 *
 * Takes the year rather than reading the clock, so a caller can be tested and
 * so the About panel is not quietly asserting a copyright year for a build
 * that did not exist yet.
 */
export function copyrightYears(currentYear: number): string {
  const now = Number.isFinite(currentYear) ? Math.trunc(currentYear) : COPYRIGHT_FROM
  return now > COPYRIGHT_FROM ? `${COPYRIGHT_FROM}-${now}` : String(COPYRIGHT_FROM)
}

/** The whole line, as shown in the app. */
export function copyrightLine(currentYear: number): string {
  return `Copyright (c) ${copyrightYears(currentYear)} ${COPYRIGHT_HOLDER}.`
}
