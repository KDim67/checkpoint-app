import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { SETTINGS_ENTRIES, searchSettings, searchable, type SettingsEntry } from '../src/renderer/src/lib/settingsSearch'

const where = (entry: SettingsEntry): string => `${entry.tab} ${entry.under ?? ''}`
const names = (query: string, entries: readonly SettingsEntry[] = SETTINGS_ENTRIES): string[] =>
  searchSettings(entries, query, where).map(entry => entry.name)

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? sources(join(dir, item.name)) : /\.tsx?$/.test(item.name) ? [readFileSync(join(dir, item.name), 'utf8')] : []
  )
}

describe('the settings index', () => {
  it('names every setting exactly as the screen does, so a result lands on what it says', () => {
    const screens = [
      ...sources('src/renderer/src/components/settings'),
      readFileSync('src/renderer/src/components/SettingsView.tsx', 'utf8'),
      // the lists some screens draw their rows from
      ...['src/shared/startupSettings.ts', 'src/shared/notificationPolicy.ts', 'src/shared/connections.ts', 'src/renderer/src/lib/features.ts', 'src/renderer/src/lib/shortcuts.ts']
        .map(file => readFileSync(file, 'utf8'))
    ].join('\n')
    const missing = SETTINGS_ENTRIES.filter(entry => !screens.includes(entry.name) || (entry.under && !screens.includes(entry.under)))
    expect(missing.map(entry => entry.name)).toEqual([])
  })

  it('never lists the same setting twice in one section', () => {
    const keys = SETTINGS_ENTRIES.map(entry => `${entry.tab}:${entry.under ?? ''}:${entry.name}`)
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([])
  })
})

describe('searchable text', () => {
  it('ignores case, accents and punctuation, and reads & as and', () => {
    expect(searchable('  Café & Wi-Fi (LAN)! ')).toBe('cafe and wi fi lan')
  })
})

describe('searching settings', () => {
  it('finds a setting by its own words first, then by the words people use for it', () => {
    expect(names('font size')[0]).toBe('Font size')
    expect(names('text scale')).toContain('Font size')
    expect(names('dark')).toContain('Interface theme')
  })

  it('needs every word typed, in any order', () => {
    expect(names('size font')).toContain('Font size')
    expect(names('font zebra')).toEqual([])
  })

  it('matches the section a setting is in, and the heading it sits under', () => {
    expect(names('wall select')).toContain('Select')
    expect(names('kanban card mark done')).toContain('Mark done')
  })

  it('puts an exact name ahead of names that only start with it, and keeps the list order for ties', () => {
    const entries: SettingsEntry[] = [
      { name: 'Backup Interval', tab: 'backup' },
      { name: 'Backup', tab: 'features', terms: ['vault'] },
      { name: 'Automated Backups', tab: 'backup' }
    ]
    expect(names('backup', entries)).toEqual(['Backup', 'Backup Interval', 'Automated Backups'])
  })

  it('ranks a search word starting one of the words people use above one buried inside a word', () => {
    const entries: SettingsEntry[] = [
      { name: 'Alpha', tab: 'general', terms: ['subtext'] },
      { name: 'Beta', tab: 'general', terms: ['text size'] }
    ]
    expect(names('text', entries)).toEqual(['Beta', 'Alpha'])
  })

  it('treats an empty or punctuation-only search as no search', () => {
    expect(names('')).toEqual([])
    expect(names(' -- ')).toEqual([])
  })
})
