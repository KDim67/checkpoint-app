/** flat folder vs tree: unique titles, repointed links, rewritten embeds, frontmatter off; pure */

export interface VaultImportResult {
  notesImported: number
  notesOverwritten: number
  attachmentsCopied: number
  /** so the caller can show renames */
  renamed: { from: string; to: string }[]
  /** said out loud, like a board import */
  notes: string[]
}

/** vault housekeeping, not notes */
const SKIPPED_DIRECTORIES = ['.obsidian', '.trash', '.git', 'node_modules']

/** not read at all */
export function isSkippedPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/)
  return parts.some(part => SKIPPED_DIRECTORIES.includes(part) || part.startsWith('.'))
}

export interface Frontmatter {
  /** without # */
  tags: string[]
  /** for reporting what wasn't carried */
  keys: string[]
  /** block removed */
  body: string
}

/** tiny YAML subset, only tags maps onto anything */
export function stripFrontmatter(markdown: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)
  if (!match) return { tags: [], keys: [], body: markdown }

  const tags: string[] = []
  const keys: string[] = []
  let collecting = false

  for (const line of match[1].split(/\r?\n/)) {
    const listItem = /^\s*-\s+(.*)$/.exec(line)
    if (listItem) {
      if (collecting) tags.push(listItem[1])
      continue
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (!pair) continue

    const [, key, rawValue] = pair
    keys.push(key)
    collecting = key.toLowerCase() === 'tags' || key.toLowerCase() === 'tag'
    if (!collecting) continue

    const value = rawValue.trim()
    if (value === '') continue
    // [a, b] and a, b both show up
    for (const part of value.replace(/^\[|\]$/g, '').split(',')) {
      tags.push(part)
    }
  }

  const cleaned = tags
    .map(tag => tag.trim().replace(/^['"]|['"]$/g, '').replace(/^#/, ''))
    .filter(tag => tag !== '')

  return {
    tags: [...new Set(cleaned)],
    keys: [...new Set(keys)],
    body: markdown.slice(match[0].length)
  }
}

/** picked up by our #tag scan */
export function tagLine(tags: string[]): string {
  // spaces and slashes break our tag pattern, so project/checkpoint becomes project-checkpoint
  const usable = tags
    .map(tag => tag.trim().replace(/[\s/]+/g, '-').replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(tag => tag !== '')
  return usable.length === 0 ? '' : usable.map(tag => `#${tag}`).join(' ')
}

/** folder/sub/Note.md to Note */
export function baseTitle(relPath: string): string {
  const file = relPath.split(/[\\/]/).pop() ?? relPath
  return file.replace(/\.md$/i, '')
}

/** duplicates take their folder name, then a number */
export function planTitles(relPaths: string[]): Map<string, string> {
  const titles = new Map<string, string>()
  const taken = new Set<string>()

  // sorted so a vault always yields the same titles
  for (const relPath of [...relPaths].sort()) {
    const base = baseTitle(relPath) || 'Untitled'
    let title = base

    if (taken.has(title.toLowerCase())) {
      const parts = relPath.split(/[\\/]/)
      const folder = parts.length > 1 ? parts[parts.length - 2] : ''
      if (folder) title = `${base} (${folder})`
    }

    let n = 2
    while (taken.has(title.toLowerCase())) {
      title = `${base} ${n}`
      n++
    }

    taken.add(title.toLowerCase())
    titles.set(relPath, title)
  }

  return titles
}

/** only renamed targets change */
export function repointLinks(markdown: string, renamed: Map<string, string>): string {
  if (renamed.size === 0) return markdown

  return markdown.replace(
    /\[\[([^\]|#^]+)((?:[#^][^\]|]*)?)(\|[^\]]*)?\]\]/g,
    (whole, target: string, anchor: string, alias: string) => {
      // the last path segment is the note
      const name = target.trim().split(/[\\/]/).pop() ?? ''
      const replacement = renamed.get(name.toLowerCase())
      if (!replacement) return whole
      // alias kept
      return `[[${replacement}${anchor ?? ''}${alias ?? ''}]]`
    }
  )
}

/** as written in the note */
export function collectAttachmentTargets(markdown: string): string[] {
  const targets: string[] = []

  // ![[image.png]] and ![[folder/image.png|200]]
  for (const m of markdown.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    targets.push(m[1].trim())
  }
  // ![alt](path/to/image.png) and ![alt](<path with spaces.png>)
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*\)/g)) {
    const target = m[1].trim()
    // already addressable, left alone
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    targets.push(decodeURIComponent(target))
  }

  return [...new Set(targets.filter(t => t !== '' && !/\.md$/i.test(t)))]
}

/** assets/my diagram.png to "my diagram" */
function fileStem(target: string): string {
  const file = target.split(/[\\/]/).pop() ?? target
  return file.replace(/\.[^.]+$/, '')
}

/** unmapped targets stay untouched rather than break */
export function rewriteAttachments(markdown: string, resolved: Map<string, string>): string {
  if (resolved.size === 0) return markdown

  const lookup = (target: string): string | undefined =>
    resolved.get(target) ?? resolved.get(decodeURIComponent(target))

  return markdown
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (whole, target: string, alias?: string) => {
      const filename = lookup(target.trim())
      if (!filename) return whole
      // an embed alias is usually a width, fall back to the file name
      const alt = alias && !/^\d+(x\d+)?$/.test(alias) ? alias : fileStem(target)
      return `![${alt}](checkpoint-media://${filename})`
    })
    .replace(/!\[([^\]]*)\]\(\s*<?([^)>]+?)>?\s*\)/g, (whole, alt: string, target: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target.trim())) return whole
      const filename = lookup(target.trim())
      return filename ? `![${alt}](checkpoint-media://${filename})` : whole
    })
}

/** frontmatter off, tags kept, links and embeds pointed right */
export function convertNote(
  markdown: string,
  renamed: Map<string, string>,
  attachments: Map<string, string>
): { content: string; frontmatterKeys: string[] } {
  const front = stripFrontmatter(markdown)
  let content = rewriteAttachments(repointLinks(front.body, renamed), attachments)

  const line = tagLine(front.tags)
  if (line) content = `${line}\n\n${content.replace(/^\s+/, '')}`

  return { content, frontmatterKeys: front.keys }
}
