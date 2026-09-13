/** one copy of the copyright; keep in step with LICENSE, a test checks */

/** first release year, never moves */
export const COPYRIGHT_FROM = 2026

/** as written in LICENSE */
export const COPYRIGHT_HOLDER = 'Dimitrios Koutsompinas'

/** takes the year, so it's testable and never claims a future build */
export function copyrightYears(currentYear: number): string {
  const now = Number.isFinite(currentYear) ? Math.trunc(currentYear) : COPYRIGHT_FROM
  return now > COPYRIGHT_FROM ? `${COPYRIGHT_FROM}-${now}` : String(COPYRIGHT_FROM)
}

/** as shown in the app */
export function copyrightLine(currentYear: number): string {
  return `Copyright (c) ${copyrightYears(currentYear)} ${COPYRIGHT_HOLDER}.`
}
