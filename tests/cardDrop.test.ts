import { describe, it, expect } from 'vitest'
import {
  POSITION_STEP,
  cardAbove,
  dropIndex,
  dropTargetAt,
  lastCardIn,
  positionForIndex,
  type CardBox,
  type ColumnBox
} from '../src/shared/cardDrop'

// Two columns side by side with a gutter between them, the shape the board
// actually has: full-height columns, a gap, and empty space past the last one.
const TODO: ColumnBox = { id: 'todo', left: 100, right: 400, top: 0, bottom: 800 }
const DONE: ColumnBox = { id: 'done', left: 420, right: 720, top: 0, bottom: 800 }
const COLUMNS = [TODO, DONE]

// Three cards, 100 tall, with the 8px gap the column's flex layout puts
// between them. Midpoints at 150, 258 and 366.
const CARDS: CardBox[] = [
  { id: 'a', column: 'todo', top: 100, height: 100 },
  { id: 'b', column: 'todo', top: 208, height: 100 },
  { id: 'c', column: 'todo', top: 316, height: 100 }
]

describe('cardAbove', () => {
  it('puts the pointer above a card it is in the top half of', () => {
    expect(cardAbove(CARDS, 'todo', 120)).toBe('a')
    expect(cardAbove(CARDS, 'todo', 230)).toBe('b')
  })

  it('puts the pointer below a card it is in the bottom half of', () => {
    expect(cardAbove(CARDS, 'todo', 180)).toBe('b')
    expect(cardAbove(CARDS, 'todo', 290)).toBe('c')
  })

  // This is the bug the whole file exists for. The gap is inside no card, so
  // asking which card the pointer was in found none and the drop fell through
  // to the column, which means the end of the list.
  it('gives the gap between two cards to the card below it', () => {
    expect(cardAbove(CARDS, 'todo', 204)).toBe('b')
    expect(cardAbove(CARDS, 'todo', 312)).toBe('c')
  })

  it('reads above the first card as the top of the list', () => {
    expect(cardAbove(CARDS, 'todo', 0)).toBe('a')
    expect(cardAbove(CARDS, 'todo', 10)).toBe('a')
  })

  it('reads past the last card as the end of the list', () => {
    expect(cardAbove(CARDS, 'todo', 400)).toBe(null)
    expect(cardAbove(CARDS, 'todo', 780)).toBe(null)
  })

  it('ignores cards in other columns', () => {
    const mixed: CardBox[] = [...CARDS, { id: 'z', column: 'done', top: 0, height: 100 }]
    expect(cardAbove(mixed, 'done', 10)).toBe('z')
    expect(cardAbove(mixed, 'done', 120)).toBe(null)
  })

  it('has no opinion about an empty column', () => {
    expect(cardAbove(CARDS, 'done', 300)).toBe(null)
    expect(cardAbove([], 'todo', 300)).toBe(null)
  })

  it('does not depend on the cards arriving in order', () => {
    const shuffled = [CARDS[2], CARDS[0], CARDS[1]]
    expect(cardAbove(shuffled, 'todo', 204)).toBe('b')
    expect(cardAbove(shuffled, 'todo', 10)).toBe('a')
  })
})

describe('lastCardIn', () => {
  it('finds the bottom card of a column', () => {
    expect(lastCardIn(CARDS, 'todo')).toBe('c')
  })

  it('does not depend on the cards arriving in order', () => {
    expect(lastCardIn([CARDS[1], CARDS[2], CARDS[0]], 'todo')).toBe('c')
  })

  it('has nothing to name in an empty column', () => {
    expect(lastCardIn(CARDS, 'done')).toBe(null)
    expect(lastCardIn([], 'todo')).toBe(null)
  })
})

describe('dropTargetAt', () => {
  it('finds the card the pointer is over', () => {
    expect(dropTargetAt(COLUMNS, CARDS, { x: 200, y: 120 }))
      .toEqual({ column: 'todo', before: 'a' })
  })

  it('finds the end of the column below the last card', () => {
    expect(dropTargetAt(COLUMNS, CARDS, { x: 200, y: 600 }))
      .toEqual({ column: 'todo', before: null })
  })

  it('finds an empty column', () => {
    expect(dropTargetAt(COLUMNS, CARDS, { x: 500, y: 300 }))
      .toEqual({ column: 'done', before: null })
  })

  // The gutter, the board's own padding and the Add Column tile are all
  // outside every column. Snapping to the nearest one keeps the preview on
  // screen instead of blinking out every time the pointer crosses a gap.
  it('snaps to the nearer column from the gutter between them', () => {
    expect(dropTargetAt(COLUMNS, CARDS, { x: 405, y: 120 })?.column).toBe('todo')
    expect(dropTargetAt(COLUMNS, CARDS, { x: 416, y: 120 })?.column).toBe('done')
  })

  it('snaps back from the empty space past the last column', () => {
    expect(dropTargetAt(COLUMNS, CARDS, { x: 1200, y: 300 })?.column).toBe('done')
  })

  it('carries the pointer height into the column it snapped to', () => {
    // Level with card b, so the snap lands mid-list rather than at the end.
    expect(dropTargetAt(COLUMNS, CARDS, { x: 60, y: 230 }))
      .toEqual({ column: 'todo', before: 'b' })
  })

  it('has no target above or below the board', () => {
    expect(dropTargetAt(COLUMNS, CARDS, { x: 200, y: -20 })).toBe(null)
    expect(dropTargetAt(COLUMNS, CARDS, { x: 200, y: 900 })).toBe(null)
  })

  it('has no target when there are no columns', () => {
    expect(dropTargetAt([], CARDS, { x: 200, y: 120 })).toBe(null)
  })
})

describe('dropIndex', () => {
  const order = ['a', 'b', 'c']

  it('inserts a card from another column above the one named', () => {
    expect(dropIndex(order, 'x', 'a')).toBe(0)
    expect(dropIndex(order, 'x', 'b')).toBe(1)
    expect(dropIndex(order, 'x', 'c')).toBe(2)
  })

  it('sends a card from another column to the end when nothing is named', () => {
    expect(dropIndex(order, 'x', null)).toBe(3)
  })

  it('moves a card up its own column to the slot it was shown in', () => {
    expect(dropIndex(order, 'c', 'a')).toBe(0)
    expect(dropIndex(order, 'c', 'b')).toBe(1)
  })

  // The preview shifts every card the dragged one passes up into the slot it
  // left, so dropping "above c" on the way down is the same gesture as landing
  // where c was. Without the step of one the card landed one slot short of
  // where the preview had just shown it.
  it('moves a card down its own column to the slot it was shown in', () => {
    expect(dropIndex(order, 'a', 'b')).toBe(1)
    expect(dropIndex(order, 'a', 'c')).toBe(2)
  })

  it('sends a card to the end of its own column', () => {
    expect(dropIndex(order, 'a', null)).toBe(2)
    expect(dropIndex(order, 'b', null)).toBe(2)
  })

  // Dragging past the last card of your own column names that card instead of
  // the column, because dnd-kit can only part the list around another card and
  // naming the column parted nothing, so the drag looked dead. The two have to
  // mean the same thing or the card would land one slot short of the bottom.
  it('reads the bottom card of your own column as the end of it', () => {
    expect(dropIndex(order, 'a', 'c')).toBe(dropIndex(order, 'a', null))
    expect(dropIndex(order, 'b', 'c')).toBe(dropIndex(order, 'b', null))
  })

  it('leaves a column holding nothing but the dragged card alone', () => {
    expect(dropIndex(['a'], 'a', 'a')).toBe(0)
  })

  it('leaves a card on its own slot where it is', () => {
    expect(dropIndex(order, 'a', 'a')).toBe(0)
    expect(dropIndex(order, 'b', 'b')).toBe(1)
    expect(dropIndex(order, 'c', 'c')).toBe(2)
  })

  it('falls back to the end for a card that is not in the column', () => {
    expect(dropIndex(order, 'x', 'gone')).toBe(3)
  })

  it('handles an empty destination', () => {
    expect(dropIndex([], 'x', null)).toBe(0)
    expect(dropIndex([], 'x', 'a')).toBe(0)
  })

  // Reordering one column is the same operation either way round, so the
  // answer has to survive being applied.
  it('agrees with lifting the card out and putting it back', () => {
    const move = (list: string[], dragged: string, before: string | null): string[] => {
      const rest = list.filter(id => id !== dragged)
      rest.splice(dropIndex(list, dragged, before), 0, dragged)
      return rest
    }
    expect(move(order, 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(move(order, 'a', 'b')).toEqual(['b', 'a', 'c'])
    expect(move(order, 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(move(order, 'c', 'b')).toEqual(['a', 'c', 'b'])
    expect(move(order, 'b', null)).toEqual(['a', 'c', 'b'])
    expect(move(order, 'b', 'b')).toEqual(['a', 'b', 'c'])
  })
})

describe('positionForIndex', () => {
  it('gives the first card in an empty column a whole step', () => {
    expect(positionForIndex([], 0)).toBe(POSITION_STEP)
    expect(positionForIndex([], 5)).toBe(POSITION_STEP)
  })

  it('halves its way in above the first card', () => {
    expect(positionForIndex([1000, 2000], 0)).toBe(500)
  })

  it('steps a whole way past the last card', () => {
    expect(positionForIndex([1000, 2000], 2)).toBe(3000)
    expect(positionForIndex([1000, 2000], 9)).toBe(3000)
  })

  it('splits the difference in the middle', () => {
    expect(positionForIndex([1000, 2000, 3000], 1)).toBe(1500)
    expect(positionForIndex([1000, 2000, 3000], 2)).toBe(2500)
  })

  // Halving only makes room above a positive number. A column renumbered down
  // to zero, or one carrying a negative from an older build, would otherwise
  // have handed the new card the very position it was meant to go above.
  it('steps away from a first card that halving cannot get above', () => {
    expect(positionForIndex([0, 1000], 0)).toBe(-POSITION_STEP)
    expect(positionForIndex([-40, 1000], 0)).toBe(-1040)
  })

  it('asks for a renumber when there is no room between two cards', () => {
    expect(positionForIndex([1000, 1000], 1)).toBe(null)
    expect(positionForIndex([1000, 1000.000001], 1)).toBe(null)
  })

  it('still splits a gap that is small but real', () => {
    expect(positionForIndex([1000, 1000.1], 1)).toBeCloseTo(1000.05, 6)
  })

  it('sorts where it said it would', () => {
    const positions = [1000, 2000, 3000]
    for (let index = 0; index <= positions.length; index++) {
      const placed = positionForIndex(positions, index)
      expect(placed).not.toBe(null)
      const sorted = [...positions, placed as number].sort((a, b) => a - b)
      expect(sorted.indexOf(placed as number)).toBe(index)
    }
  })
})
