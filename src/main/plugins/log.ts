/** the last lines each plugin logged, for its row in Settings; the console alone is invisible in an installed app */

import type { PluginLogLine } from '../../shared/types'

export const LOG_KEEP = 100
export const LOG_LINES_PER_MINUTE = 120
export const LOG_LINE_CHARS = 2000

export class PluginLog {
  private lines = new Map<string, PluginLogLine[]>()
  private times = new Map<string, number[]>()
  private dropping = new Set<string>()

  /** dropping is the first line refused in a burst, so the caller can say so once */
  write(filename: string, level: PluginLogLine['level'], text: string, now = Date.now()): 'kept' | 'dropping' | 'dropped' {
    const recent = (this.times.get(filename) ?? []).filter(t => now - t < 60_000)
    if (recent.length >= LOG_LINES_PER_MINUTE) {
      this.times.set(filename, recent)
      if (this.dropping.has(filename)) return 'dropped'
      this.dropping.add(filename)
      this.keep(filename, { at: now, level: 'error', text: `Logging more than ${LOG_LINES_PER_MINUTE} lines a minute; the rest of this minute is dropped.` })
      return 'dropping'
    }
    this.dropping.delete(filename)
    recent.push(now)
    this.times.set(filename, recent)
    this.keep(filename, { at: now, level, text: text.slice(0, LOG_LINE_CHARS) })
    return 'kept'
  }

  read(filename: string): PluginLogLine[] {
    return [...(this.lines.get(filename) ?? [])]
  }

  private keep(filename: string, line: PluginLogLine): void {
    const list = this.lines.get(filename) ?? []
    list.push(line)
    if (list.length > LOG_KEEP) list.splice(0, list.length - LOG_KEEP)
    this.lines.set(filename, list)
  }
}
