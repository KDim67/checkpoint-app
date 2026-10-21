import { describe, expect, it } from 'vitest'
import { matching, parseCapture, typingAt, withPick, workspaceNamed } from '../src/renderer/src/lib/quickCapture'

describe('reading a captured line', () => {
  it('makes a log entry unless switched, and a task from a leading "- " or "[ ] "', () => {
    expect(parseCapture('Called the bank', 'log').kind).toBe('log')
    expect(parseCapture('Called the bank', 'task').kind).toBe('task')
    expect(parseCapture('- Call the bank', 'log')).toMatchObject({ kind: 'task', title: 'Call the bank' })
    expect(parseCapture('[ ] Call the bank', 'log')).toMatchObject({ kind: 'task', title: 'Call the bank' })
  })

  it('takes out the workspace, tags and priority, leaving the title', () => {
    expect(parseCapture('- Fix the banner @Work #ui #sync !high', 'log')).toMatchObject({
      title: 'Fix the banner',
      workspace: 'Work',
      tags: ['ui', 'sync'],
      priority: 3
    })
    expect(parseCapture('Note !2', 'log').priority).toBe(2)
    expect(parseCapture('Plain', 'log')).toMatchObject({ workspace: null, tags: [], priority: 0, dueAt: null })
  })

  it('reads a date in the words, keeping a tag that looks like a day a tag', () => {
    const dated = parseCapture('Ship it tomorrow 3pm', 'task')
    expect(dated.dueAt).not.toBeNull()
    expect(dated.title).toBe('Ship it')
    expect(parseCapture('Plan #tuesday', 'log')).toMatchObject({ tags: ['tuesday'], dueAt: null })
  })
})

describe('what is being typed at the caret', () => {
  it('finds an @ or # word the caret is at the end of', () => {
    expect(typingAt('Fix @wo', 7)).toEqual({ marker: '@', query: 'wo', start: 4, end: 7 })
    expect(typingAt('#', 1)).toEqual({ marker: '#', query: '', start: 0, end: 1 })
    expect(typingAt('Fix @work now', 13)).toBeNull()
    expect(typingAt('mail@home', 9)).toBeNull()
  })

  it('puts a pick in place of the word, and the caret after it', () => {
    expect(withPick('Fix @wo', { marker: '@', query: 'wo', start: 4, end: 7 }, 'work')).toEqual({ text: 'Fix @work ', caret: 10 })
    // the rest of a word under the caret goes too, and no space doubles up
    expect(withPick('Fix #u later', { marker: '#', query: 'u', start: 4, end: 6 }, 'ui')).toEqual({ text: 'Fix #ui later', caret: 8 })
  })
})

describe('suggestions', () => {
  const list = [
    { slug: 'home', name: 'Home' },
    { slug: 'wordle-clone', name: 'Wordle clone' },
    { slug: 'work', name: 'Work' },
    { slug: 'network', name: 'Network lab' }
  ]
  const names = (entry: { slug: string; name: string }): string[] => [entry.slug, entry.name]

  it('lists names starting with what is typed before names only holding it', () => {
    expect(matching(list, 'wor', names).map(e => e.slug)).toEqual(['wordle-clone', 'work', 'network'])
    expect(matching(list, '', names, 2).map(e => e.slug)).toEqual(['home', 'wordle-clone'])
  })

  it('knows a workspace whatever case it is typed in, by slug or by name', () => {
    expect(workspaceNamed(list, 'WORK')?.slug).toBe('work')
    expect(workspaceNamed(list, 'network lab')?.slug).toBe('network')
    expect(workspaceNamed(list, 'Home')?.slug).toBe('home')
    expect(workspaceNamed(list, 'unity')).toBeNull()
  })
})
