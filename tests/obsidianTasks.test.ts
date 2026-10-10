import { describe, expect, it } from 'vitest'
import { joinLines, parseTasks, rewriteTask, splitLines } from '../src/shared/obsidianTasks'

describe('finding tasks in a note', () => {
  it('reads each kind of list item with a box, and what each mark means', () => {
    const tasks = parseTasks([
      '- [ ] Buy milk',
      '* [x] Paid rent',
      '+ [X] Shouty done',
      '1. [-] Dropped the idea',
      '  2) [/] Halfway',
      '- [] not a task',
      '-[ ] not a task either',
      'Plain text'
    ].join('\n'))
    expect(tasks.map(t => [t.line, t.title, t.done])).toStrictEqual([
      [0, 'Buy milk', false], [1, 'Paid rent', true], [2, 'Shouty done', true], [3, 'Dropped the idea', true], [4, 'Halfway', false]
    ])
  })

  it('reads the Tasks plugin\'s fields, Dataview\'s due date and a block id, leaving the title clean', () => {
    const [a, b, c] = parseTasks([
      '- [ ] Ship the release #work ⏫ 🔁 every week 📅 2026-10-12 ^cp-4f2a9c1e',
      '- [ ] Call the bank [due:: 2026-10-14] [where:: phone] ^call-bank',
      '- [ ] Water plants 🔽 ⏳ 2026-10-01 ✅ 2026-09-30'
    ].join('\n'))
    expect(a).toMatchObject({ title: 'Ship the release #work', due: '2026-10-12', dueStyle: 'emoji', recurring: 'every week', priority: 3, blockId: 'cp-4f2a9c1e' })
    expect(b).toMatchObject({ title: 'Call the bank', due: '2026-10-14', dueStyle: 'dataview', recurring: null, priority: 0, blockId: 'call-bank' })
    expect(c).toMatchObject({ title: 'Water plants', due: null, dueStyle: null, priority: 1, blockId: null })
  })

  it('skips lines inside code blocks and front matter', () => {
    const tasks = parseTasks(['---', 'tags: [x]', '- [ ] in front matter', '---', '```', '- [ ] in code', '```', '~~~md', '- [ ] in tildes', '~~~', '- [ ] real'].join('\n'))
    expect(tasks.map(t => t.title)).toStrictEqual(['real'])
  })
})

describe('rewriting one task line', () => {
  const line = '  - [ ] Ship the release [owner:: me] ⏫ 📅 2026-10-12 ^cp-4f2a9c1e'

  it('ticks and unticks the box, and reopens a cancelled task', () => {
    expect(rewriteTask(line, { done: true })).toBe('  - [x] Ship the release [owner:: me] ⏫ 📅 2026-10-12 ^cp-4f2a9c1e')
    expect(rewriteTask('- [x] Done ^a', { done: false })).toBe('- [ ] Done ^a')
    expect(rewriteTask('- [-] Dropped', { done: false })).toBe('- [ ] Dropped')
  })

  it('changes the title, keeping Dataview fields, the Tasks fields and the id', () => {
    expect(rewriteTask(line, { title: 'Ship 2.0' })).toBe('  - [ ] Ship 2.0 [owner:: me] ⏫ 📅 2026-10-12 ^cp-4f2a9c1e')
  })

  it('changes, adds and clears the date in the line\'s own format', () => {
    expect(rewriteTask(line, { due: '2026-10-20' })).toBe('  - [ ] Ship the release [owner:: me] ⏫ 📅 2026-10-20 ^cp-4f2a9c1e')
    expect(rewriteTask(line, { due: null })).toBe('  - [ ] Ship the release [owner:: me] ⏫ ^cp-4f2a9c1e')
    expect(rewriteTask('- [ ] Call [due:: 2026-10-14]', { due: '2026-10-15' })).toBe('- [ ] Call [due:: 2026-10-15]')
    expect(rewriteTask('- [ ] Call [due:: 2026-10-14] ^b', { due: null })).toBe('- [ ] Call ^b')
    expect(rewriteTask('- [ ] Plain', { due: '2026-10-15' })).toBe('- [ ] Plain 📅 2026-10-15')
  })

  it('adds a block id to a line without one, and keeps one it has', () => {
    expect(rewriteTask('- [ ] Plain 📅 2026-10-15', { blockId: 'cp-00000001' })).toBe('- [ ] Plain 📅 2026-10-15 ^cp-00000001')
    expect(rewriteTask('- [ ] Kept ^mine', { blockId: 'cp-00000001' })).toBe('- [ ] Kept ^mine')
  })
})

describe('a note\'s lines', () => {
  it('come back exactly as they were, line endings, final newline and BOM included', () => {
    for (const text of ['a\r\nb\r\n', 'a\nb', '﻿a\nb\n', '']) {
      expect(joinLines(splitLines(text))).toBe(text)
    }
    const note = splitLines('﻿first\r\n- [ ] task\r\n')
    note.lines[1] = '- [x] task'
    expect(joinLines(note)).toBe('﻿first\r\n- [x] task\r\n')
  })
})
