import { describe, it, expect } from 'vitest'
import { LOG_KEEP, LOG_LINE_CHARS, LOG_LINES_PER_MINUTE, PluginLog } from '../src/main/plugins/log'

describe('a plugin\'s log', () => {
  it('keeps the latest lines per plugin, apart from every other plugin\'s', () => {
    const log = new PluginLog()
    for (let i = 0; i < LOG_KEEP + 5; i++) log.write('a.js', 'info', `line ${i}`, i * 1000)
    log.write('b.js', 'error', 'boom', 0)
    const kept = log.read('a.js')
    expect(kept).toHaveLength(LOG_KEEP)
    expect(kept[0].text).toBe('line 5')
    expect(log.read('b.js')).toStrictEqual([{ at: 0, level: 'error', text: 'boom' }])
    expect(log.read('never.js')).toStrictEqual([])
  })

  it('cuts an absurdly long line', () => {
    const log = new PluginLog()
    log.write('a.js', 'info', 'x'.repeat(LOG_LINE_CHARS * 2))
    expect(log.read('a.js')[0].text).toHaveLength(LOG_LINE_CHARS)
  })

  it('drops a flood, says so once, and takes lines again a minute later', () => {
    const log = new PluginLog()
    const results = Array.from({ length: LOG_LINES_PER_MINUTE + 3 }, (_, i) => log.write('a.js', 'info', `n${i}`, 1000))
    expect(results.filter(r => r === 'kept')).toHaveLength(LOG_LINES_PER_MINUTE)
    expect(results.filter(r => r === 'dropping')).toHaveLength(1)
    expect(log.read('a.js').at(-1)?.text).toContain('dropped')
    expect(log.write('a.js', 'info', 'later', 61_001)).toBe('kept')
  })
})
