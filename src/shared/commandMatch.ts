/**
 * Matching and ranking for the command palette. Split from the command list so
 * the ranking can be tested: a palette that puts the wrong row first is worse
 * than no palette, because you stop trusting Enter.
 *
 * Subsequence matching with position bonuses, like every editor. "gok" finds
 * "Go to Kanban", "kgo" matches nothing.
 */

export interface CommandLike {
  id: string
  /** What the user reads and is mainly matching against. */
  label: string
  /** Section heading, also matchable so "settings" finds every settings row. */
  group: string
  /** Extra terms that should find this command but are not worth displaying. */
  keywords?: string[]
}

const WORD_BOUNDARY = /[\s\-_/:.]/

/**
 * Scores one string against a query. 0 means no match.
 *
 * Bonuses, in descending order: the first character of the text, the start of a
 * word, and continuing a run from the previous matched character. That ordering
 * is what makes initials work. "Gtk" scores well on "Go To Kanban" because all
 * three land on word starts.
 */
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 1
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()

  let score = 0
  let from = 0
  let previousMatch = -2

  for (const char of needle) {
    // Spaces in the query are separators, not characters to find.
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

  // A match in a short label is a better match than the same one buried in a
  // long label, so "log" prefers "Log" over "Open Settings: Activity Log".
  return score + Math.max(0, 24 - hay.length) / 6
}

/**
 * Best score for a command across everything it can be found by.
 *
 * The label carries full weight; keywords and the group are discounted so a
 * literal label match always outranks an incidental keyword hit.
 */
export function scoreCommand(command: CommandLike, query: string): number {
  if (!query.trim()) return 1

  let best = fuzzyScore(command.label, query)
  for (const keyword of command.keywords ?? []) {
    best = Math.max(best, fuzzyScore(keyword, query) * 0.8)
  }
  best = Math.max(best, fuzzyScore(command.group, query) * 0.6)
  // Matching across "group label" catches "settings mcp", which neither field
  // answers on its own.
  best = Math.max(best, fuzzyScore(`${command.group} ${command.label}`, query) * 0.5)
  return best
}

/**
 * Filters and orders commands for a query.
 *
 * With no query the original order is kept. That order is authored, grouping
 * navigation before the rarer actions, and re-sorting it alphabetically would
 * throw that away.
 */
export function rankCommands<T extends CommandLike>(commands: T[], query: string, limit = 40): T[] {
  if (!query.trim()) return commands.slice(0, limit)

  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter(entry => entry.score > 0)
    // Ties fall back to authored order rather than to whatever sort() does with
    // equal keys, so the list cannot reshuffle between identical queries.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.command)
}
