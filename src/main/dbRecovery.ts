/** a bad db used to throw before createWindow so nothing drew; move it aside, never delete the only copy */

import { existsSync, renameSync } from 'fs'
import { RELEASES_PAGE } from '../shared/releaseNotes'

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

/** where the newest installer always is */
export const RELEASES_URL = `${RELEASES_PAGE}/latest`

/** the data is fine and untouched, only this copy of the app is too old for it, so the way out is updating */
export function newerDatabaseNotice(appVersion: string): { title: string; message: string; detail: string; buttons: [string, string] } {
  return {
    title: 'Checkpoint needs updating',
    message: 'Your data was saved by a newer version of Checkpoint',
    detail: [
      `This copy of Checkpoint (${appVersion}) is older than your data, so it stopped before opening it and nothing was changed.`,
      '',
      'Install the latest version and everything will be as you left it.'
    ].join('\n'),
    buttons: ['Get the latest version', 'Quit']
  }
}

/** colons aren't legal in paths on windows or macOS */
export function stampFor(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-')
}
