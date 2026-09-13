import { describe, it, expect } from 'vitest'
import {
  escapeCsvField,
  toCsv,
  itemsToCsv,
  itemsToMarkdown,
  toJsonExport,
  exportFilename,
  EXPORT_FORMATS
} from '../src/shared/exportFormats'
import type { Item } from '../src/shared/types'

const item = (over: Partial<Item> = {}): Item => ({
  id: 'i1',
  type: 'card',
  context: 'test',
  title: 'A card',
  body: '',
  status: 'open',
  priority: 2,
  position: 0,
  created_at: Date.UTC(2026, 0, 1),
  updated_at: Date.UTC(2026, 0, 2),
  due_at: null,
  metadata: '{}',
  tags: [],
  ...over
}) as Item

describe('escapeCsvField', () => {
  it('leaves an ordinary value alone', () => {
    expect(escapeCsvField('hello')).toBe('hello')
  })

  it('renders null and undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('')
    expect(escapeCsvField(undefined)).toBe('')
  })

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"')
  })

  it('doubles embedded quotes', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes a field containing a newline', () => {
    // multi-line bodies break naive CSV
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"')
    expect(escapeCsvField('with\r\nCRLF')).toBe('"with\r\nCRLF"')
  })

  it('defuses a value that would run as a spreadsheet formula', () => {
    // titles can come from webhooks or agents
    expect(escapeCsvField('=1+1')).toBe("'=1+1")
    expect(escapeCsvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"')
    for (const leader of ['+', '-', '@']) {
      expect(escapeCsvField(`${leader}danger`)).toBe(`'${leader}danger`)
    }
  })

  it('does not mistake a normal minus inside text for a formula', () => {
    expect(escapeCsvField('a-b')).toBe('a-b')
  })

  it('handles a number', () => {
    expect(escapeCsvField(3)).toBe('3')
  })
})

describe('toCsv', () => {
  it('writes a header and rows separated by CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('a,b\r\n1,2\r\n')
  })

  it('writes just a header for no rows', () => {
    expect(toCsv(['a'], [])).toBe('a\r\n')
  })
})

describe('itemsToCsv', () => {
  it('includes a header row and one line per item', () => {
    const csv = itemsToCsv([item(), item({ id: 'i2', title: 'Second' })])
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('title')
  })

  it('renders dates as ISO and empty when absent', () => {
    const csv = itemsToCsv([item({ due_at: Date.UTC(2026, 5, 1) })])
    expect(csv).toContain('2026-06-01T00:00:00.000Z')
    expect(itemsToCsv([item()])).toMatch(/,,/)
  })

  it('joins tag names', () => {
    const csv = itemsToCsv([
      item({ tags: [{ id: 't1', name: 'bug', color: '#f00' }, { id: 't2', name: 'ui', color: '#0f0' }] } as Partial<Item>)
    ])
    expect(csv).toContain('bug; ui')
  })

  it('survives a body with commas, quotes and newlines', () => {
    const csv = itemsToCsv([item({ body: 'has, a comma\nand "quotes"' })])
    // one header plus one record, however many newlines
    const records = csv.trim().split(/\r\n(?=[0-9a-zA-Z-]+,)/)
    expect(records).toHaveLength(2)
    expect(csv).toContain('""quotes""')
  })
})

describe('itemsToMarkdown', () => {
  it('groups by status', () => {
    const md = itemsToMarkdown([item({ status: 'open' }), item({ id: 'i2', status: 'done' })])
    expect(md).toContain('## open')
    expect(md).toContain('## done')
  })

  it('ticks the box for finished work', () => {
    expect(itemsToMarkdown([item({ status: 'done' })])).toContain('- [x]')
    expect(itemsToMarkdown([item({ status: 'open' })])).toContain('- [ ]')
  })

  it('says so when there is nothing', () => {
    expect(itemsToMarkdown([])).toContain('Nothing to export')
  })

  it('indents a multi-line body so it stays inside its bullet', () => {
    const md = itemsToMarkdown([item({ body: 'first\nsecond' })])
    expect(md).toContain('  first')
    expect(md).toContain('  second')
  })

  it('shows priority, due date and tags when present', () => {
    const md = itemsToMarkdown([
      item({ priority: 3, due_at: Date.UTC(2026, 5, 1), tags: [{ id: 't', name: 'bug', color: '#f00' }] } as Partial<Item>)
    ])
    expect(md).toContain('High')
    expect(md).toContain('`bug`')
  })

  it('uses a placeholder for an untitled item', () => {
    expect(itemsToMarkdown([item({ title: '' })])).toContain('(untitled)')
  })
})

describe('toJsonExport', () => {
  it('is valid JSON carrying the items and a stamp', () => {
    const parsed = JSON.parse(toJsonExport([item()], 'test', Date.UTC(2026, 0, 1)))
    expect(parsed.itemCount).toBe(1)
    expect(parsed.context).toBe('test')
    expect(parsed.exportedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(parsed.items[0].id).toBe('i1')
  })

  it('marks an all-workspace export with a null context', () => {
    expect(JSON.parse(toJsonExport([], null, 0)).context).toBeNull()
  })
})

describe('exportFilename', () => {
  it('names the workspace, the date and the format', () => {
    expect(exportFilename('reality-mender', 'csv', Date.UTC(2026, 0, 15)))
      .toBe('checkpoint-reality-mender-2026-01-15.csv')
  })

  it('strips characters a filesystem would refuse', () => {
    const name = exportFilename('my/weird:name*', 'json', Date.UTC(2026, 0, 15))
    expect(name).not.toMatch(/[/:*]/)
    expect(name.endsWith('.json')).toBe(true)
  })

  it('falls back when there is no workspace', () => {
    expect(exportFilename(null, 'markdown', Date.UTC(2026, 0, 15)))
      .toBe('checkpoint-all-workspaces-2026-01-15.md')
  })

  it('gives every declared format an extension', () => {
    for (const format of EXPORT_FORMATS) {
      expect(exportFilename('x', format.id, 0).endsWith(`.${format.extension}`), format.id).toBe(true)
    }
  })
})
