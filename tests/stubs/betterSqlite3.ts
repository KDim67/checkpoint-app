/**
 * A better-sqlite3-shaped facade over Node's built-in `node:sqlite`.
 *
 * WHY this exists: better-sqlite3 in this repo is compiled against Electron's
 * Node ABI (see the `electron-rebuild` postinstall). Plain Node, which is what
 * Vitest runs on, cannot dlopen it, and rebuilding it for Node would leave the
 * shipped app unable to open its own database. `node:sqlite` links the same
 * SQLite engine (3.53, FTS5 included) and is already available on the Node 24
 * this project runs, so the migration code under test executes against a real
 * SQLite file rather than a mock.
 *
 * WHAT this is NOT: a general better-sqlite3 replacement. It implements only
 * the surface src/main/db.ts actually touches. Anything it does not implement
 * throws rather than silently succeeding, so a test can never pass because a
 * call quietly did nothing.
 */

import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite'

type Row = Record<string, unknown>

/** node:sqlite hands back null-prototype rows; callers expect plain objects. */
function plain(row: unknown): Row | undefined {
  return row == null ? undefined : { ...(row as Row) }
}

class StatementFacade {
  readonly #stmt: StatementSync

  constructor(stmt: StatementSync) {
    this.#stmt = stmt
  }

  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.#stmt.run(...(params as SQLInputValue[]))
  }

  get(...params: unknown[]): Row | undefined {
    return plain(this.#stmt.get(...(params as SQLInputValue[])))
  }

  all(...params: unknown[]): Row[] {
    return this.#stmt.all(...(params as SQLInputValue[])).map((r) => plain(r) as Row)
  }
}

export default class DatabaseFacade {
  readonly #db: DatabaseSync
  /**
   * better-sqlite3 transactions nest by promoting to SAVEPOINTs. db.ts nests
   * them (initDb's migration transaction wraps table rebuilds, IPC handlers
   * wrap helper writes), so an inner transaction must join the outer one
   * instead of failing on "cannot start a transaction within a transaction".
   */
  #depth = 0

  constructor(path: string) {
    this.#db = new DatabaseSync(path)
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    const rows = this.#db.prepare(`PRAGMA ${source}`).all().map((r) => plain(r) as Row)
    if (options?.simple) {
      const first = rows[0]
      return first ? Object.values(first)[0] : undefined
    }
    return rows
  }

  exec(sql: string): void {
    this.#db.exec(sql)
  }

  prepare(sql: string): StatementFacade {
    return new StatementFacade(this.#db.prepare(sql))
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const savepoint = `sp_${this.#depth}`
      this.#db.exec(this.#depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
      this.#depth += 1
      try {
        const result = fn(...args)
        this.#depth -= 1
        this.#db.exec(this.#depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
        return result
      } catch (err) {
        this.#depth -= 1
        this.#db.exec(this.#depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`)
        throw err
      }
    }
  }

  close(): void {
    this.#db.close()
  }
}
