/** better-sqlite3 is built for electron's ABI, node:sqlite runs the same SQLite; unimplemented calls throw */

import { DatabaseSync, backup, type StatementSync, type SQLInputValue } from 'node:sqlite'

type Row = Record<string, unknown>

/** null-prototype rows to plain objects */
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
  /** nested transactions become SAVEPOINTs, like better-sqlite3 */
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

  /** instance method over node:sqlite's backup function, so the vault is tested for real */
  backup(destination: string): Promise<void> {
    return backup(this.#db, destination).then(() => undefined)
  }

  close(): void {
    this.#db.close()
  }
}
