/**
 * What to do when the database will not open.
 *
 * A local-first app keeps everything the user has in one SQLite file. If that
 * file is damaged, by a power cut mid-write, a failing disk, or a half-finished
 * copy from LAN sync, `new Database()` throws. That throw used to happen before
 * `createWindow()`, so the app started, failed silently and never drew
 * anything: the user double-clicks the icon and nothing happens.
 *
 * The damaged file is moved aside rather than deleted. It is the only copy of
 * their work, a later SQLite build may well recover it, and an app that
 * quietly destroys the thing it failed to read is worse than one that will not
 * start.
 */

import { existsSync, renameSync } from 'fs'

/** SQLite keeps the write-ahead log and shared-memory file beside the database. */
const SIDECARS = ['', '-wal', '-shm']

interface QuarantineResult {
  /** Where the unreadable database was moved to, for the message to the user. */
  movedTo: string
  /** Sidecars that moved with it. A stale WAL would corrupt the fresh file. */
  alsoMoved: string[]
}

/**
 * Moves an unreadable database and its sidecars out of the way.
 *
 * `stamp` is passed in rather than read from the clock so the caller decides,
 * and so this can be tested without freezing time.
 */
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
      // A locked sidecar must not stop the main file being moved: without the
      // move there is nowhere for a fresh database to go and the app cannot
      // start at all.
      console.error(`[db] Could not move ${from} aside:`, err)
    }
  }

  return { movedTo, alsoMoved }
}

/** What to tell the user, given where their old database ended up. */
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

/** A filename-safe stamp. Colons are legal in a path on neither Windows nor macOS. */
export function stampFor(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-')
}
