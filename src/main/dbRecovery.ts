/** a bad db used to throw before createWindow so nothing drew; move it aside, never delete the only copy */

import { existsSync, renameSync } from 'fs'

/** WAL and SHM live beside the db */
const SIDECARS = ['', '-wal', '-shm']

interface QuarantineResult {
  movedTo: string
  /** a stale WAL would corrupt the fresh file */
  alsoMoved: string[]
}

/** stamp passed in so tests don't have to freeze time */
export function quarantineDatabase(dbPath: string, stamp: string): QuarantineResult {
  const movedTo = `${dbPath}.corrupt-${stamp}`
  const alsoMoved: string[] = []

  for (const suffix of SIDECARS) {
    const from = `${dbPath}${suffix}`
    if (!existsSync(from)) continue

    const to = `${movedTo}${suffix}`
    try {
      renameSync(from, to)
      if (suffix) alsoMoved.push(to)
    } catch (err) {
      // a locked sidecar mustn't block moving the main file, or there's nowhere for a fresh db
      console.error(`[db] Could not move ${from} aside:`, err)
    }
  }

  return { movedTo, alsoMoved }
}

export function recoveryMessage(movedTo: string, backupDir: string): string {
  return [
    'Checkpoint could not open its database, so it started with an empty one.',
    '',
    `The file that would not open has been kept, not deleted:`,
    movedTo,
    '',
    `Automatic backups, if they were switched on, are in:`,
    backupDir,
    '',
    'Restore one through Settings, Backups.'
  ].join('\n')
}

/** colons aren't legal in paths on windows or macOS */
export function stampFor(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-')
}
