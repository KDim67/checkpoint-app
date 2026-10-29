import fs from 'fs'
import path from 'path'
import type { NoteMetadata, NoteSearchResult } from '../shared/types'
import { clearTombstone, recordTombstone } from './db'
import { getConfigDir, getNotesDir, ensureDir, resolveSafePath as resolveInDir } from './paths'

/** idempotent, fast after the first call */
let _notesFsReady = false
function initNotesFs(): void {
  if (_notesFsReady) return
  ensureDir(getConfigDir())
  ensureDir(getNotesDir())
  _notesFsReady = true
}

function resolveSafePath(title: string): string {
  return resolveInDir(getNotesDir(), title, '.md')
}

/** one-line plain-text preview for the note list */
function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')               // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // images
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // wiki-links
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')   // markdown links
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')        // headings
    .replace(/^\s{0,3}>\s?/gm, '')             // blockquotes
    .replace(/^\s{0,3}[-*+]\s+/gm, '')         // bullet lists
    .replace(/^\s{0,3}\d+\.\s+/gm, '')         // ordered lists
    .replace(/[*_~]{1,3}/g, '')                // emphasis / strikethrough
    .replace(/\s+/g, ' ')                      // collapse whitespace
    .trim()
}

/** skips a leading H1 that repeats the title */
function buildExcerpt(content: string, title: string): string {
  const lines = content.split('\n')
  const firstMeaningful = lines.findIndex(l => l.trim() !== '')
  if (firstMeaningful !== -1) {
    const h = lines[firstMeaningful].match(/^\s{0,3}#\s+(.*)$/)
    if (h && h[1].trim().toLowerCase() === title.trim().toLowerCase()) {
      lines.splice(0, firstMeaningful + 1)
    }
  }
  const plain = toPlainText(lines.join('\n'))
  return plain.length > 180 ? `${plain.slice(0, 180).trimEnd()}…` : plain
}

/** lower-cased, deduped */
function extractTags(content: string): string[] {
  const tagMatches = content.match(/(?:^|\s)(#[a-zA-Z0-9_-]+)/g) || []
  return Array.from(
    new Set(
      tagMatches
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 1) // lone '#'
    )
  )
}

/** original case, deduped, alias-aware */
function extractLinks(content: string): string[] {
  const linkMatches = content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)
  return Array.from(new Set(Array.from(linkMatches).map(m => m[1].trim())))
}

/** a note as of its last read, trusted while its file keeps that time and size, so a change by any program is still seen */
interface KnownNote {
  filePath: string
  mtimeMs: number
  size: number
  meta: NoteMetadata
  /** its text for search; left out of a very large note, which search reads afresh instead */
  plain: string | null
}

const known = new Map<string, KnownNote>()
/** a vault of thousands read one file at a time took most of a second, on every save and every search */
const READS_AT_ONCE = 32
/** past this a note's text isn't kept between searches, so one huge file can't hold the memory */
const KEEP_TEXT_UP_TO = 512 * 1024

async function inPool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await work(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function describeNote(filePath: string, content: string, stats: fs.Stats): KnownNote {
  const title = path.basename(filePath, '.md')
  return {
    filePath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    meta: {
      title,
      tags: extractTags(content),
      links: extractLinks(content),
      updatedAt: stats.mtimeMs,
      size: stats.size,
      excerpt: buildExcerpt(content, title)
    },
    plain: content.length <= KEEP_TEXT_UP_TO ? toPlainText(content) : null
  }
}

/** every note, read again only where its file changed since it was last read */
async function scanNotes(): Promise<KnownNote[]> {
  const dir = getNotesDir()
  const files = (await fs.promises.readdir(dir)).filter(f => f.toLowerCase().endsWith('.md'))
  const present = new Set(files.map(file => path.join(dir, file)))
  for (const filePath of known.keys()) if (!present.has(filePath)) known.delete(filePath)

  const notes = await inPool([...present], READS_AT_ONCE, async filePath => {
    try {
      const stats = await fs.promises.stat(filePath)
      const before = known.get(filePath)
      if (before && before.mtimeMs === stats.mtimeMs && before.size === stats.size) return before
      const note = describeNote(filePath, await fs.promises.readFile(filePath, 'utf-8'), stats)
      known.set(filePath, note)
      return note
    } catch (err) {
      // gone since the listing, or unreadable: left out, rather than one file emptying the whole list
      known.delete(filePath)
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Failed to read note "${path.basename(filePath)}":`, err)
      return null
    }
  })
  return notes.filter((note): note is KnownNote => note !== null)
}

export async function listNotes(): Promise<NoteMetadata[]> {
  initNotesFs()
  try {
    const notes = await scanNotes()
    return notes.map(note => note.meta).sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (err) {
    console.error('Failed to list markdown notes:', err)
    return []
  }
}

export async function readNote(title: string): Promise<string> {
  initNotesFs()
  try {
    const filePath = resolveSafePath(title)
    if (!fs.existsSync(filePath)) {
      return ''
    }
    return await fs.promises.readFile(filePath, 'utf-8')
  } catch (err) {
    console.error(`Failed to read note "${title}":`, err)
    return ''
  }
}

/** renaming onto a different existing note is refused, never overwrite */
export async function writeNote(title: string, content: string, oldTitle?: string): Promise<void> {
  initNotesFs()

  const trimmedTitle = title.trim()
  if (!trimmedTitle) {
    throw new Error('Note title cannot be empty')
  }

  try {
    const newPath = resolveSafePath(trimmedTitle)

    if (oldTitle && oldTitle !== trimmedTitle) {
      const oldPath = resolveSafePath(oldTitle)
      if (fs.existsSync(newPath) && newPath !== oldPath) {
        throw new Error(`A note titled "${trimmedTitle}" already exists`)
      }
      if (fs.existsSync(oldPath)) {
        await fs.promises.rename(oldPath, newPath)
      }
      known.delete(oldPath)
    }

    await fs.promises.writeFile(newPath, content, 'utf-8')
    // a disk that keeps times to the second could show the same time and size after a quick second save
    known.delete(newPath)
    clearTombstone(trimmedTitle.endsWith('.md') ? trimmedTitle : `${trimmedTitle}.md`, 'notes')
  } catch (err) {
    console.error(`Failed to write note "${title}":`, err)
    throw err
  }
}

export async function deleteNote(title: string): Promise<void> {
  initNotesFs()
  try {
    const filename = title.endsWith('.md') ? title : `${title}.md`
    recordTombstone(filename, 'notes')
    const filePath = resolveSafePath(title)
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath)
    }
    known.delete(filePath)
  } catch (err) {
    console.error(`Failed to delete note "${title}":`, err)
    throw err
  }
}

/** title and body, snippet around the first hit, ranked */
export async function searchNotes(query: string): Promise<NoteSearchResult[]> {
  initNotesFs()
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return []

  try {
    const notes = await scanNotes()

    const results: NoteSearchResult[] = []

    for (const note of notes) {
      const title = note.meta.title
      const plain = note.plain ?? toPlainText(await fs.promises.readFile(note.filePath, 'utf-8').catch(() => ''))
      const haystack = plain.toLowerCase()
      const titleMatch = title.toLowerCase().includes(trimmed)

      // no regex, the query may have special chars
      let matchCount = 0
      let idx = haystack.indexOf(trimmed)
      const firstIdx = idx
      while (idx !== -1) {
        matchCount++
        idx = haystack.indexOf(trimmed, idx + trimmed.length)
      }

      if (matchCount === 0 && !titleMatch) continue

      let snippet: string
      if (firstIdx !== -1) {
        const start = Math.max(0, firstIdx - 40)
        const end = Math.min(plain.length, firstIdx + trimmed.length + 80)
        snippet = `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`
      } else {
        snippet = plain.slice(0, 120)
      }

      results.push({ title, snippet, matchCount, titleMatch })
    }

    // title matches first, then body match count
    return results.sort((a, b) => {
      if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1
      return b.matchCount - a.matchCount
    })
  } catch (err) {
    console.error('Failed to search notes:', err)
    return []
  }
}
