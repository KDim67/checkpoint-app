import { describe, it, expect } from 'vitest'
import {
  cheatsheetBudget,
  collectAttachments,
  fileCap,
  noteCap
} from '../src/renderer/src/components/ai/attachmentContext'
import type { Message } from '../src/renderer/src/components/ai/types'

const msg = (over: Partial<Message> = {}): Message => ({ role: 'user', content: '', ...over })

describe('cheatsheetBudget', () => {
  it('splits the budget across the attached sheets rather than giving each the whole', () => {
    // five docs at full budget each eat the window
    const one = cheatsheetBudget(false, 32000, 1)
    const five = cheatsheetBudget(false, 32000, 5)
    expect(five).toBeLessThan(one)
    expect(five * 5).toBeLessThanOrEqual(one + 5)
  })

  it('never quotes a sheet so thinly that it says nothing', () => {
    expect(cheatsheetBudget(false, 32000, 1000)).toBe(1500)
    expect(cheatsheetBudget(true, 2048, 100)).toBe(1500)
  })

  it('holds small models to a flat, much smaller total', () => {
    expect(cheatsheetBudget(true, 200000, 1)).toBe(6000)
  })

  it('caps the total even for an enormous context window', () => {
    expect(cheatsheetBudget(false, 1000000, 1)).toBe(60000)
  })

  it('does not divide by zero when nothing is attached', () => {
    expect(Number.isFinite(cheatsheetBudget(false, 32000, 0))).toBe(true)
  })
})

describe('noteCap and fileCap', () => {
  it('give small models less of everything', () => {
    expect(noteCap(true)).toBeLessThan(noteCap(false))
    expect(fileCap(true)).toBeLessThan(fileCap(false))
  })

  it('allow more of a source file than of a note', () => {
    // source needs context, notes are prose
    expect(fileCap(false)).toBeGreaterThan(noteCap(false))
  })
})

describe('collectAttachments', () => {
  it('gathers across the whole conversation, not just the last message', () => {
    // a doc from five turns ago is still the topic
    const messages = [
      msg({ cheatsheets: ['api.pdf'] }),
      msg({ role: 'assistant', content: 'ok' }),
      msg({ notes: ['Lore'] })
    ]
    const got = collectAttachments(messages)
    expect(got.cheatsheets).toEqual(['api.pdf'])
    expect(got.notes).toEqual(['Lore'])
  })

  it('deduplicates something attached in several turns', () => {
    const messages = [msg({ files: ['src/a.ts'] }), msg({ files: ['src/a.ts', 'src/b.ts'] })]
    expect(collectAttachments(messages).files).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('returns empty lists for a conversation with no attachments', () => {
    expect(collectAttachments([msg({ content: 'hello' })])).toEqual({
      cheatsheets: [], notes: [], files: []
    })
  })

  it('ignores fields that are not arrays', () => {
    const broken = { role: 'user', content: '', notes: 'oops' } as unknown as Message
    expect(collectAttachments([broken]).notes).toEqual([])
  })
})
