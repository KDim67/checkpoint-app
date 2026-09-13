/** split so ranking is testable; subsequence with position bonuses */

export interface CommandLike {
  id: string
  label: string
  /** matchable, so "settings" finds every settings row */
  group: string
  /** found by these, not shown */
  keywords?: string[]
}

const WORD_BOUNDARY = /[\s\-_/:.]/

/** bonuses: first char, word starts, runs; that's what makes initials work */
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 1
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()

  let score = 0
  let from = 0
  let previousMatch = -2

  for (const char of needle) {
    // spaces separate
    if (char === ' ') continue

    const at = hay.indexOf(char, from)
    if (at === -1) return 0

    if (at === 0) score += 12
    else if (WORD_BOUNDARY.test(hay[at - 1])) score += 9
    else if (at === previousMatch + 1) score += 6
    else score += 1

    previousMatch = at
    from = at + 1
  }

  // shorter labels win the same match
  return score + Math.max(0, 24 - hay.length) / 6
}

/** label full weight, keywords and group discounted */
export function scoreCommand(command: CommandLike, query: string): number {
  if (!query.trim()) return 1

  let best = fuzzyScore(command.label, query)
  for (const keyword of command.keywords ?? []) {
    best = Math.max(best, fuzzyScore(keyword, query) * 0.8)
  }
  best = Math.max(best, fuzzyScore(command.group, query) * 0.6)
  // across "group label" catches "settings mcp"
  best = Math.max(best, fuzzyScore(`${command.group} ${command.label}`, query) * 0.5)
  return best
}

/** an empty query keeps authored order */
export function rankCommands<T extends CommandLike>(commands: T[], query: string, limit = 40): T[] {
  if (!query.trim()) return commands.slice(0, limit)

  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter(entry => entry.score > 0)
    // ties keep authored order so identical queries don't reshuffle
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.command)
}
