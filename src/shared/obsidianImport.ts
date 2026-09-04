/**
 * Reading an Obsidian vault into Checkpoint's notes.
 *
 * The two formats are close enough that most of a vault needs no translation
 * at all: both are plain Markdown files with `[[wiki links]]` and `#tags`. The
 * differences are the ones handled here.
 *
 * - Checkpoint's notes are a flat folder, a vault is a tree. Two notes called
 *   "Index" in different folders would collide, so titles are made unique and
 *   the links that pointed at them are repointed to match.
 * - Vault attachments live in the vault; Checkpoint's live in its media folder
 *   behind the `checkpoint-media://` protocol, so embeds are rewritten.
 * - YAML frontmatter renders as junk in a plain Markdown view, so it comes off,
 *   and any tags in it are kept as ordinary `#tags`.
 *
 * All of this is pure. The caller does the walking, copying and writing.
 */

export interface VaultImportResult {
  notesImported: number
  notesOverwritten: number
  attachmentsCopied: number
  /** Notes whose title had to change, so the caller can show which. */
  renamed: { from: string; to: string }[]
  /** Anything worth saying out loud, in the same spirit as a board import. */
  notes: string[]
}

/** Folders a vault keeps for itself, which are not notes. */
const SKIPPED_DIRECTORIES = ['.obsidian', '.trash', '.git', 'node_modules']

/** True for a vault path that should not be read at all. */
export function isSkippedPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/)
  return parts.some(part => SKIPPED_DIRECTORIES.includes(part) || part.startsWith('.'))
}

export interface Frontmatter {
  /** Tags found in the block, without their `#`. */
  tags: string[]
  /** Everything the block said, for reporting what could not be carried. */
  keys: string[]
  /** The note with the block removed. */
  body: string
}

/**
 * Pulls a leading `---` block off a note.
 *
 * A deliberately small YAML subset: `key: value`, `key: [a, b]` and a block
 * list under `key:`. Anything more would be a YAML parser, and the only field
 * that maps onto something Checkpoint has is `tags`.
 */
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
    // `[a, b]` and `a, b` both appear in the wild.
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

/** A tag line Checkpoint's own `#tag` scan will pick up. */
export function tagLine(tags: string[]): string {
  // Spaces and slashes do not survive Checkpoint's tag pattern, so a nested
  // "project/checkpoint" becomes "project-checkpoint" rather than truncating
  // at the slash and quietly merging every project into one tag.
  const usable = tags
    .map(tag => tag.trim().replace(/[\s/]+/g, '-').replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(tag => tag !== '')
  return usable.length === 0 ? '' : usable.map(tag => `#${tag}`).join(' ')
}

/** `folder/sub/Note.md` → `Note`. */
export function baseTitle(relPath: string): string {
  const file = relPath.split(/[\\/]/).pop() ?? relPath
  return file.replace(/\.md$/i, '')
}

/**
 * A flat, unique title per note.
 *
 * Duplicates take the name of the folder they came from, which is the thing
 * that distinguished them in the vault. A second collision falls back to a
 * number, because two folders can share a name too.
 */
export function planTitles(relPaths: string[]): Map<string, string> {
  const titles = new Map<string, string>()
  const taken = new Set<string>()

  // Sorted so the same vault always produces the same titles, whatever order
  // the filesystem hands the files over in.
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

/**
 * Wiki links whose target had to be renamed, so they still point at the note
 * they meant. A link to a name that stayed the same is left exactly as it was.
 */
export function repointLinks(markdown: string, renamed: Map<string, string>): string {
  if (renamed.size === 0) return markdown

  return markdown.replace(
    /\[\[([^\]|#^]+)((?:[#^][^\]|]*)?)(\|[^\]]*)?\]\]/g,
    (whole, target: string, anchor: string, alias: string) => {
      // Vault links can carry a path; the last segment is the note name.
      const name = target.trim().split(/[\\/]/).pop() ?? ''
      const replacement = renamed.get(name.toLowerCase())
      if (!replacement) return whole
      // The alias is kept, so a link that displayed as something specific
      // still displays as that after the rename.
      return `[[${replacement}${anchor ?? ''}${alias ?? ''}]]`
    }
  )
}

/** Every attachment a note points at, as written in the note. */
export function collectAttachmentTargets(markdown: string): string[] {
  const targets: string[] = []

  // ![[image.png]] and ![[folder/image.png|200]]
  for (const m of markdown.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    targets.push(m[1].trim())
  }
  // ![alt](path/to/image.png) and ![alt](<path with spaces.png>)
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*\)/g)) {
    const target = m[1].trim()
    // Anything already addressable is left alone.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    targets.push(decodeURIComponent(target))
  }

  return [...new Set(targets.filter(t => t !== '' && !/\.md$/i.test(t)))]
}

/** `assets/my diagram.png` → `my diagram`, for alt text. */
function fileStem(target: string): string {
  const file = target.split(/[\\/]/).pop() ?? target
  return file.replace(/\.[^.]+$/, '')
}

/**
 * Points embeds at the media folder. `resolved` maps a target as written in
 * the note to the media filename it was copied to; anything missing from it is
 * left untouched rather than turned into a broken link.
 */
export function rewriteAttachments(markdown: string, resolved: Map<string, string>): string {
  if (resolved.size === 0) return markdown

  const lookup = (target: string): string | undefined =>
    resolved.get(target) ?? resolved.get(decodeURIComponent(target))

  return markdown
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (whole, target: string, alias?: string) => {
      const filename = lookup(target.trim())
      if (!filename) return whole
      // An Obsidian embed alias is usually a width, which Markdown has no way
      // to express, so the alt text falls back to the file's own name.
      const alt = alias && !/^\d+(x\d+)?$/.test(alias) ? alias : fileStem(target)
      return `![${alt}](checkpoint-media://${filename})`
    })
    .replace(/!\[([^\]]*)\]\(\s*<?([^)>]+?)>?\s*\)/g, (whole, alt: string, target: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target.trim())) return whole
      const filename = lookup(target.trim())
      return filename ? `![${alt}](checkpoint-media://${filename})` : whole
    })
}

/**
 * The finished note: frontmatter off, its tags kept, links and embeds pointing
 * where they should.
 */
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
