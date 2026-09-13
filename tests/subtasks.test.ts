import { describe, it, expect } from 'vitest'
import {
  computeProgress,
  hasChecklist,
  nextPosition,
  normalizeSubtask,
  normalizeSubtasks,
  parseChecklist,
  type Subtask
} from '../src/shared/subtasks'

const sub = (over: Partial<Subtask> = {}): Subtask => ({
  id: 's1',
  itemId: 'i1',
  title: 'A subtask',
  done: false,
  position: 1000,
  ...over
})

describe('computeProgress', () => {
  it('is empty and safe for no subtasks', () => {
    expect(computeProgress([])).toEqual({ total: 0, done: 0, ratio: 0 })
  })

  it('counts what is finished', () => {
    const progress = computeProgress([sub(), sub({ id: 's2', done: true })])
    expect(progress).toEqual({ total: 2, done: 1, ratio: 0.5 })
  })

  it('reaches one when everything is done', () => {
    expect(computeProgress([sub({ done: true })]).ratio).toBe(1)
  })
})

describe('normalizeSubtask', () => {
  it('rejects a row with no identity', () => {
    expect(normalizeSubtask(null)).toBeNull()
    expect(normalizeSubtask({ id: 's', itemId: 'i' })).toBeNull()
    expect(normalizeSubtask({ id: 's', title: 't' })).toBeNull()
    expect(normalizeSubtask({ itemId: 'i', title: 't' })).toBeNull()
  })

  it('reads the snake_case column the database actually returns', () => {
    expect(normalizeSubtask({ id: 's', item_id: 'i', title: 't' })?.itemId).toBe('i')
  })

  it('treats SQLite 0/1 as a boolean', () => {
    // no boolean column type
    expect(normalizeSubtask({ id: 's', item_id: 'i', title: 't', done: 1 })?.done).toBe(true)
    expect(normalizeSubtask({ id: 's', item_id: 'i', title: 't', done: 0 })?.done).toBe(false)
  })

  it('trims the title and rejects one that is only whitespace', () => {
    expect(normalizeSubtask({ id: 's', item_id: 'i', title: '  t  ' })?.title).toBe('t')
    expect(normalizeSubtask({ id: 's', item_id: 'i', title: '   ' })).toBeNull()
  })
})

describe('normalizeSubtasks', () => {
  it('drops malformed rows and orders by position', () => {
    const out = normalizeSubtasks([
      { id: 'b', item_id: 'i', title: 'second', position: 2000 },
      null,
      { id: 'a', item_id: 'i', title: 'first', position: 1000 }
    ])
    expect(out.map(s => s.title)).toEqual(['first', 'second'])
  })

  it('returns nothing for a non-array', () => {
    expect(normalizeSubtasks(null)).toEqual([])
    expect(normalizeSubtasks('nope')).toEqual([])
  })
})

describe('nextPosition', () => {
  it('starts at a round number', () => {
    expect(nextPosition([])).toBe(1000)
  })

  it('leaves room to insert between neighbours', () => {
    expect(nextPosition([sub({ position: 1000 }), sub({ id: 's2', position: 2000 })])).toBe(3000)
  })

  it('appends after the highest, not after the last in the array', () => {
    expect(nextPosition([sub({ position: 5000 }), sub({ id: 's2', position: 1000 })])).toBe(6000)
  })
})

describe('parseChecklist', () => {
  it('finds unchecked and checked lines', () => {
    const { items } = parseChecklist('- [ ] first\n- [x] second')
    expect(items).toEqual([
      { title: 'first', done: false },
      { title: 'second', done: true }
    ])
  })

  it('accepts an uppercase X and an asterisk bullet', () => {
    const { items } = parseChecklist('* [X] shouty')
    expect(items).toEqual([{ title: 'shouty', done: true }])
  })

  it('accepts an indented line', () => {
    expect(parseChecklist('   - [ ] nested').items).toHaveLength(1)
  })

  it('leaves an empty checkbox alone', () => {
    // likely a template, not a subtask named ""
    const { items, remainingBody } = parseChecklist('- [ ] ')
    expect(items).toHaveLength(0)
    expect(remainingBody).toBe('- [ ]')
  })

  it('ignores an ordinary bullet', () => {
    expect(parseChecklist('- just a bullet').items).toHaveLength(0)
  })

  it('returns the body with the checkboxes removed', () => {
    const { remainingBody } = parseChecklist('Some notes.\n- [ ] a task\nMore notes.')
    expect(remainingBody).toBe('Some notes.\nMore notes.')
  })

  it('does not leave a hole where a block of checkboxes was', () => {
    const { remainingBody } = parseChecklist('Before\n\n- [ ] one\n- [ ] two\n\nAfter')
    expect(remainingBody).toBe('Before\n\nAfter')
  })

  it('leaves a body with no checkboxes untouched apart from trimming', () => {
    expect(parseChecklist('Just prose.').remainingBody).toBe('Just prose.')
  })

  it('handles an empty or missing body', () => {
    expect(parseChecklist('')).toEqual({ items: [], remainingBody: '' })
    expect(parseChecklist(undefined as unknown as string).items).toEqual([])
  })

  it('preserves the order the lines appeared in', () => {
    const { items } = parseChecklist('- [ ] a\n- [x] b\n- [ ] c')
    expect(items.map(i => i.title)).toEqual(['a', 'b', 'c'])
  })
})

describe('hasChecklist', () => {
  it('is true only when something is convertible', () => {
    expect(hasChecklist('- [ ] something')).toBe(true)
    expect(hasChecklist('no checkboxes here')).toBe(false)
    expect(hasChecklist('- [ ] ')).toBe(false)
  })
})
