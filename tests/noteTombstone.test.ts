import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearTombstone, closeDb, getDb, initDb, recordTombstone } from '../src/main/db'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-note-tombstone-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const marked = (): string[] =>
  (getDb().prepare('SELECT id FROM sync_tombstones ORDER BY id').all() as { id: string }[]).map(row => row.id)

describe('a note deleted and then brought back', () => {
  it('stops reading as deleted once it is written again', () => {
    recordTombstone('Plans.md', 'notes')
    recordTombstone('Other.md', 'notes')
    expect(marked()).toStrictEqual(['Other.md', 'Plans.md'])

    clearTombstone('Plans.md', 'notes')

    expect(marked()).toStrictEqual(['Other.md'])
  })

  it('leaves a tombstone of the same id from another table alone', () => {
    recordTombstone('Plans.md', 'media')
    clearTombstone('Plans.md', 'notes')
    expect(marked()).toStrictEqual(['Plans.md'])
  })
})
