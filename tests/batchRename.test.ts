import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchRenameFiles } from '../src/main/gamedevService'

// The renamer walks over somebody's asset folder. Every case below is one where
// fs.rename would have quietly destroyed a file: it overwrites the destination
// on both Windows and POSIX, and nothing used to look at the destination at all.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-rename-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const file = (name: string, body: string): string => {
  const p = join(dir, name)
  writeFileSync(p, body)
  return p
}

describe('batchRenameFiles', () => {
  it('renames a file', async () => {
    const src = file('sprite.png', 'original')
    const dest = join(dir, 'T_sprite.png')

    const res = await batchRenameFiles([{ oldPath: src, newPath: dest }])

    expect(res.success).toBe(true)
    expect(res.renamedCount).toBe(1)
    expect(readFileSync(dest, 'utf8')).toBe('original')
    expect(existsSync(src)).toBe(false)
  })

  it('refuses to rename over a file that is already there', async () => {
    // Running the Unity texture preset twice does exactly this.
    const src = file('sprite.png', 'the new one')
    const occupied = file('T_sprite.png', 'the one from last time')

    const res = await batchRenameFiles([{ oldPath: src, newPath: occupied }])

    expect(res.success).toBe(false)
    expect(res.renamedCount).toBe(0)
    // The file that was already there is the one that matters.
    expect(readFileSync(occupied, 'utf8')).toBe('the one from last time')
    expect(existsSync(src)).toBe(true)
  })

  it('refuses when two files in the batch want the same name', async () => {
    // Search-and-replace collapsing two names onto one.
    const a = file('tex01.png', 'first')
    const b = file('tex02.png', 'second')
    const target = join(dir, 'tex.png')

    const res = await batchRenameFiles([
      { oldPath: a, newPath: target },
      { oldPath: b, newPath: target }
    ])

    expect(res.success).toBe(false)
    // The first is allowed through; the second must not land on top of it.
    expect(res.renamedCount).toBe(1)
    expect(readFileSync(target, 'utf8')).toBe('first')
    expect(existsSync(b)).toBe(true)
  })

  it('reports which rename failed and why', async () => {
    const src = file('sprite.png', 'new')
    const occupied = file('T_sprite.png', 'old')

    const res = await batchRenameFiles([{ oldPath: src, newPath: occupied }])

    expect(res.errors).toHaveLength(1)
    expect(res.errors[0].oldPath).toBe(src)
    expect(res.errors[0].newPath).toBe(occupied)
    expect(res.errors[0].error).toMatch(/already/i)
  })

  it('carries on with the rest of the batch after one refusal', async () => {
    const blocked = file('a.png', 'a')
    file('taken.png', 'do not touch')
    const fine = file('b.png', 'b')

    const res = await batchRenameFiles([
      { oldPath: blocked, newPath: join(dir, 'taken.png') },
      { oldPath: fine, newPath: join(dir, 'c.png') }
    ])

    expect(res.renamedCount).toBe(1)
    expect(readFileSync(join(dir, 'taken.png'), 'utf8')).toBe('do not touch')
    expect(readFileSync(join(dir, 'c.png'), 'utf8')).toBe('b')
  })

  it('allows a rename that changes nothing but the name it already has', async () => {
    // A no-op is not a collision with itself.
    const src = file('sprite.png', 'body')

    const res = await batchRenameFiles([{ oldPath: src, newPath: src }])

    expect(res.success).toBe(true)
    expect(readFileSync(src, 'utf8')).toBe('body')
  })

  it('still rejects relative paths and missing sources', async () => {
    const res = await batchRenameFiles([
      { oldPath: 'relative.png', newPath: join(dir, 'x.png') },
      { oldPath: join(dir, 'nope.png'), newPath: join(dir, 'y.png') }
    ])

    expect(res.success).toBe(false)
    expect(res.renamedCount).toBe(0)
    expect(res.errors).toHaveLength(2)
  })
})
