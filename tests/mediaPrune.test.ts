import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, getDb } from '../src/main/db'
import { collectDbTexts } from '../src/main/mediaService'

// what counts as a reference is all that stands between a wall of photos and nothing

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-prune-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const setSetting = (key: string, value: string): void => {
  getDb()
    .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

const references = (filename: string): boolean =>
  collectDbTexts(getDb()).some(text => text.includes(filename))

describe('what the media prune counts as a reference', () => {
  it('sees an image on a wall', () => {
    // regression: walls in app_settings weren't scanned and got pruned
    setSetting('wall_work', JSON.stringify({
      items: [{ id: 'a', kind: 'image', ref: 'ab12.png', x: 0, y: 0, width: 10, height: 10, z: 0 }],
      camera: { x: 0, y: 0, zoom: 1 }
    }))
    expect(references('ab12.png')).toBe(true)
  })

  it('sees an image on a wall other than the first', () => {
    setSetting('wall_doc_w2', JSON.stringify({
      items: [{ id: 'a', kind: 'image', ref: 'cd34.png', x: 0, y: 0, width: 10, height: 10, z: 0 }],
      camera: { x: 0, y: 0, zoom: 1 }
    }))
    expect(references('cd34.png')).toBe(true)
  })

  it('still sees the item fields it always read', () => {
    const now = Date.now()
    getDb()
      .prepare(`INSERT INTO items (id, type, context, title, body, metadata, created_at, updated_at)
                VALUES (?, 'log', 'work', ?, ?, ?, ?, ?)`)
      .run('i1', 'in the title ef56.png', 'in the body gh78.png', '{"cover":"ij90.png"}', now, now)

    expect(references('ef56.png')).toBe(true)
    expect(references('gh78.png')).toBe(true)
    expect(references('ij90.png')).toBe(true)
  })

  it('does not invent a reference for a file nothing mentions', () => {
    setSetting('wall_work', JSON.stringify({ items: [], camera: { x: 0, y: 0, zoom: 1 } }))
    expect(references('nothing-points-here.png')).toBe(false)
  })

  it('reads a table added after this was written', () => {
    // schema walk, so a new table can't bring that back
    getDb().exec('CREATE TABLE later_feature (id TEXT PRIMARY KEY, note TEXT)')
    getDb().prepare('INSERT INTO later_feature (id, note) VALUES (?, ?)').run('x', 'kl12.png')
    expect(references('kl12.png')).toBe(true)
  })

  it('survives the full-text index without reading its shadow tables', () => {
    const now = Date.now()
    getDb()
      .prepare(`INSERT INTO items (id, type, context, title, body, metadata, created_at, updated_at)
                VALUES (?, 'log', 'work', ?, '', '{}', ?, ?)`)
      .run('i2', 'mn34.png', now, now)

    // virtual tables and blob shadows mustn't throw
    expect(() => collectDbTexts(getDb())).not.toThrow()
    expect(references('mn34.png')).toBe(true)
  })
})
