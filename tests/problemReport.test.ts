import { describe, expect, it } from 'vitest'
import {
  BUG_REPORT_FORM,
  issueLink,
  issueTitle,
  reportText,
  systemName,
  windowsName,
  withoutHome,
  type ProblemReport
} from '../src/shared/problemReport'

// what a bug report says about the machine, what it hides, and how it fits in a link

const fields = (url: string): Record<string, string> => Object.fromEntries(new URL(url).searchParams)

const report = (log: string): ProblemReport => ({ version: '1.2.0', system: 'Windows 11 (build 26300)', log })

describe('the system a report names', () => {
  it('tells Windows 11 from 10 by the build, since both call themselves 10.0', () => {
    expect(windowsName('10.0.26300')).toBe('Windows 11 (build 26300)')
    expect(windowsName('10.0.22000')).toBe('Windows 11 (build 22000)')
    expect(windowsName('10.0.19045')).toBe('Windows 10 (build 19045)')
  })

  it('keeps a release it cannot read as it came', () => {
    expect(windowsName('6.1.7601')).toBe('Windows 6.1.7601')
    expect(windowsName('10.0')).toBe('Windows 10.0')
  })

  it('names macOS and Linux by their kernel release', () => {
    expect(systemName('darwin', '24.1.0')).toBe('macOS (Darwin 24.1.0)')
    expect(systemName('linux', '6.8.0-45-generic')).toBe('Linux 6.8.0-45-generic')
    expect(systemName('win32', '10.0.26300')).toBe('Windows 11 (build 26300)')
  })
})

describe('the home folder in a public report', () => {
  const home = 'C:\\Users\\dimit'

  it('becomes ~ in Windows paths, in any slash style or case', () => {
    expect(withoutHome('at C:\\Users\\dimit\\AppData\\Roaming\\checkpoint\\x.db', home)).toBe('at ~\\AppData\\Roaming\\checkpoint\\x.db')
    expect(withoutHome('at c:/users/DIMIT/Desktop/a.md', home)).toBe('at ~/Desktop/a.md')
  })

  it('becomes ~ inside the file URLs a packaged stack trace is made of', () => {
    const stack = 'Error: boom\n    at file:///C:/Users/dimit/AppData/Local/Programs/checkpoint-app/resources/app.asar/out/main/index.js:12:5'
    expect(withoutHome(stack, home)).toBe('Error: boom\n    at file:///~/AppData/Local/Programs/checkpoint-app/resources/app.asar/out/main/index.js:12:5')
  })

  it('catches a home folder with a space, written plain or URL-encoded', () => {
    const spaced = 'C:\\Users\\Jo Smith'
    expect(withoutHome('C:\\Users\\Jo Smith\\notes and file:///C:/Users/Jo%20Smith/notes', spaced)).toBe('~\\notes and file:///~/notes')
  })

  it('leaves a longer name that only starts the same', () => {
    expect(withoutHome('C:\\Users\\dimitri\\file.txt and C:\\Users\\dimit.old', home)).toBe('C:\\Users\\dimitri\\file.txt and C:\\Users\\dimit.old')
  })

  it('handles the folder at the very end, a trailing slash on the home, and an empty home', () => {
    expect(withoutHome('home is C:\\Users\\dimit', home)).toBe('home is ~')
    expect(withoutHome('at C:\\Users\\dimit\\x', 'C:\\Users\\dimit\\')).toBe('at ~\\x')
    expect(withoutHome('C:\\Users\\dimit\\x', '')).toBe('C:\\Users\\dimit\\x')
  })

  it('works for a POSIX home too', () => {
    expect(withoutHome('/home/sam/.config/checkpoint/theme.css', '/home/sam')).toBe('~/.config/checkpoint/theme.css')
  })
})

describe('the prefilled GitHub form', () => {
  it('fills the form fields by their ids, decoding back to exactly what was written', () => {
    const { url, trimmed } = issueLink(report('12:00 error [db] Failed to save: disk full'), 'Saving a card fails\nevery time I press Enter')
    expect(url.startsWith(`${BUG_REPORT_FORM}?`)).toBe(true)
    expect(fields(url)).toEqual({
      template: 'bug_report.yml',
      title: 'Saving a card fails',
      version: '1.2.0',
      os: 'Windows 11 (build 26300)',
      what: 'Saving a card fails\nevery time I press Enter',
      console: '12:00 error [db] Failed to save: disk full'
    })
    expect(trimmed).toBe(false)
  })

  it('writes spaces as %20, which GitHub cannot read as anything else', () => {
    const { url } = issueLink(report(''), 'a b')
    expect(url).toContain('what=a%20b')
    expect(url).not.toContain('+')
  })

  it('leaves out what was not filled in, so the form shows its own defaults', () => {
    const keys = Object.keys(fields(issueLink(report(''), '   ').url))
    expect(keys).toEqual(['template', 'version', 'os'])
  })

  it('drops the oldest log lines until the link fits, keeping the newest', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${String(i).padStart(3, '0')} ${'x'.repeat(60)}`)
    const { url, trimmed } = issueLink(report(lines.join('\n')), 'It broke', 4000)
    expect(url.length).toBeLessThanOrEqual(4000)
    expect(trimmed).toBe(true)
    const kept = fields(url).console.split('\n')
    expect(kept[kept.length - 1]).toBe(lines[199])
    expect(kept[0]).not.toBe(lines[0])
  })

  it('cuts what happened as a last resort, still fitting and never through a character', () => {
    const { url, trimmed } = issueLink(report('one line'), '🙂'.repeat(2000), 1000)
    expect(url.length).toBeLessThanOrEqual(1000)
    expect(trimmed).toBe(true)
    expect(fields(url).what).toMatch(/^(🙂)+$/u)
    expect(fields(url).console).toBeUndefined()
  })

  it('titles the issue with the first line, shortened past 80 characters', () => {
    expect(issueTitle('  first line  \nsecond')).toBe('first line')
    expect(issueTitle('a'.repeat(100))).toBe(`${'a'.repeat(79)}…`)
  })

  it('shortens a title by characters, so an emoji at the cut still makes a link', () => {
    const title = issueTitle(`${'a'.repeat(78)}🙂🙂🙂`)
    expect(title).toBe(`${'a'.repeat(78)}🙂…`)
    expect(() => issueLink(report(''), title)).not.toThrow()
  })
})

describe('the copied report', () => {
  it('holds everything, nothing trimmed, and says when a part is empty', () => {
    expect(reportText(report('a\nb'), 'It broke')).toBe(
      'Checkpoint 1.2.0 on Windows 11 (build 26300)\n\nWhat happened:\nIt broke\n\nRecent app log:\na\nb'
    )
    expect(reportText(report(''), ' ')).toContain('What happened:\n(not filled in)')
    expect(reportText(report(''), ' ')).toContain('Recent app log:\n(nothing recorded)')
  })
})
