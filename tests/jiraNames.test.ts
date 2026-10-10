import { describe, expect, it } from 'vitest'
import { isJiraId, isJiraKey, jiraIssueUrl, jiraPriority, normalizeJiraSite, opensJira } from '../src/shared/jira'
import { adfToMarkdown } from '../src/shared/adf'
import { linkOf } from '../src/shared/connections'

describe('a Jira Cloud site', () => {
  it('is read from a name, a host or a full address, always as https', () => {
    expect(normalizeJiraSite('acme')).toBe('https://acme.atlassian.net')
    expect(normalizeJiraSite(' Acme.atlassian.net ')).toBe('https://acme.atlassian.net')
    expect(normalizeJiraSite('https://acme.atlassian.net/jira/software/projects/ENG/boards/1')).toBe('https://acme.atlassian.net')
    expect(normalizeJiraSite('http://acme.atlassian.net')).toBe('https://acme.atlassian.net')
  })

  it('is never anywhere but atlassian.net', () => {
    expect(normalizeJiraSite('jira.mycompany.com')).toBeNull()
    expect(normalizeJiraSite('https://acme.atlassian.net.evil.example')).toBeNull()
    expect(normalizeJiraSite('https://user:pass@acme.atlassian.net')).toBeNull()
    expect(normalizeJiraSite('https://acme.atlassian.net:8443')).toBeNull()
    expect(normalizeJiraSite('')).toBeNull()
  })
})

describe('Jira names', () => {
  it('accepts its ids and keys, and opens only an issue page on a Jira site', () => {
    expect(isJiraId('10042')).toBe(true)
    expect(isJiraId('ENG-1')).toBe(false)
    expect(isJiraKey('ENG-123')).toBe(true)
    expect(isJiraKey('eng-123')).toBe(false)
    expect(jiraIssueUrl('https://acme.atlassian.net', 'ENG-123')).toBe('https://acme.atlassian.net/browse/ENG-123')
    expect(opensJira('https://acme.atlassian.net/browse/ENG-123')).toBe(true)
    expect(opensJira('https://evil.example/browse/ENG-123')).toBe(false)
    expect(linkOf(JSON.stringify({ link: { service: 'jira', id: '10042', url: 'https://acme.atlassian.net/browse/ENG-123', state: 'open', labels: [], ref: 'ENG-123' } }))?.ref).toBe('ENG-123')
    expect(linkOf(JSON.stringify({ link: { service: 'jira', id: '10042', url: 'https://acme.atlassian.net.evil.example/browse/ENG-1', state: 'open', labels: [] } }))).toBeNull()
  })

  it('reads its priority names, and none for one it doesn\'t know', () => {
    expect(['Highest', 'High', 'Medium', 'Low', 'Lowest', 'Blocker', undefined].map(jiraPriority)).toStrictEqual([3, 3, 2, 1, 1, 0, 0])
  })
})

const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content })
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) })

describe('a Jira description as Markdown', () => {
  it('keeps paragraphs, headings and inline marks', () => {
    expect(adfToMarkdown(doc(
      { type: 'heading', attrs: { level: 2 }, content: [t('Steps')] },
      p(t('Press '), t('Save', [{ type: 'strong' }]), t(' then '), t('wait', [{ type: 'em' }]), t(', see '), t('docs', [{ type: 'link', attrs: { href: 'https://example.com/docs' } }]), t(' and '), t('npm test', [{ type: 'code' }]))
    ))).toBe('## Steps\n\nPress **Save** then _wait_, see [docs](https://example.com/docs) and `npm test`')
  })

  it('keeps lists, nested ones, tasks, code, quotes and rules', () => {
    const item = (...content: unknown[]) => ({ type: 'listItem', content })
    expect(adfToMarkdown(doc(
      { type: 'bulletList', content: [item(p(t('one')), { type: 'orderedList', attrs: { order: 3 }, content: [item(p(t('three'))), item(p(t('four')))] }), item(p(t('two')))] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [t('shipped')] }, { type: 'taskItem', attrs: { state: 'TODO' }, content: [t('tested')] }] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const x = 1')] },
      { type: 'blockquote', content: [p(t('quoted')), p(t('twice'))] },
      { type: 'rule' }
    ))).toBe('- one\n  3. three\n  4. four\n- two\n\n- [x] shipped\n- [ ] tested\n\n```ts\nconst x = 1\n```\n\n> quoted\n>\n> twice\n\n---')
  })

  it('says something readable for mentions, cards, dates, tables and anything it doesn\'t know', () => {
    const cell = (type: string, text: string) => ({ type, content: [p(t(text))] })
    expect(adfToMarkdown(doc(
      p({ type: 'mention', attrs: { text: '@Maria' } }, t(' see '), { type: 'inlineCard', attrs: { url: 'https://acme.atlassian.net/browse/ENG-2' } }, t(' by '), { type: 'date', attrs: { timestamp: String(Date.UTC(2026, 9, 12)) } }, { type: 'hardBreak' }, t('next line')),
      { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'Name'), cell('tableHeader', 'Value | odd')] }, { type: 'tableRow', content: [cell('tableCell', 'a'), cell('tableCell', 'b')] }] },
      { type: 'mysteryBlock', content: [p(t('still here'))] }
    ))).toBe('@Maria see <https://acme.atlassian.net/browse/ENG-2> by 2026-10-12\nnext line\n\n| Name | Value \\| odd |\n| --- | --- |\n| a | b |\n\nstill here')
  })

  it('gives nothing for nothing, and stops at absurd depth instead of overflowing', () => {
    expect(adfToMarkdown(null)).toBe('')
    expect(adfToMarkdown('text')).toBe('')
    let deep: unknown = p(t('bottom'))
    for (let i = 0; i < 5000; i++) deep = { type: 'blockquote', content: [deep] }
    expect(() => adfToMarkdown(doc(deep))).not.toThrow()
  })
})
