import fs from 'fs'
import path from 'path'
import os from 'os'
import type { NoteMetadata, NoteSearchResult } from '../shared/types'

const CONFIG_DIR = path.join(os.homedir(), '.config', 'checkpoint')
const NOTES_DIR = path.join(CONFIG_DIR, 'notes')

/**
 * Initializes the notes directory.
 */
export function initNotesFs(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
  if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true })
  }
}

/**
 * Safely resolves a title to a file path within the notes directory,
 * preventing path traversal attacks.
 */
function resolveSafePath(title: string): string {
  // Replace characters that are illegal or problematic in filenames
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_')
  const resolvedPath = path.resolve(NOTES_DIR, `${safeTitle}.md`)
  // Use path.relative to robustly ensure the target stays inside NOTES_DIR
  const rel = path.relative(NOTES_DIR, resolvedPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path traversal detected')
  }
  return resolvedPath
}

/**
 * Reduces a chunk of markdown to a plain-text, single-line preview. Strips
 * headings, emphasis, code fences, list markers, links and wiki-links so the
 * note list can show a clean excerpt.
 */
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

/** Builds a bounded plain-text excerpt, skipping a leading H1 that just repeats the title. */
function buildExcerpt(content: string, title: string): string {
  const lines = content.split('\n')
  // Drop a leading level-1 heading that merely echoes the title.
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

/** Extracts `#tags` from note content (lower-cased, deduped). */
function extractTags(content: string): string[] {
  const tagMatches = content.match(/(?:^|\s)(#[a-zA-Z0-9_-]+)/g) || []
  return Array.from(
    new Set(
      tagMatches
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 1) // filter out solitary '#' characters
    )
  )
}

/** Extracts `[[wiki links]]` from note content (original case, deduped, alias-aware). */
function extractLinks(content: string): string[] {
  const linkMatches = content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)
  return Array.from(new Set(Array.from(linkMatches).map(m => m[1].trim())))
}

/**
 * Lists all markdown notes in the directory along with their metadata.
 */
export async function listNotes(): Promise<NoteMetadata[]> {
  initNotesFs()
  try {
    const files = await fs.promises.readdir(NOTES_DIR)
    const mdFiles = files.filter(f => f.toLowerCase().endsWith('.md'))

    const results: NoteMetadata[] = []

    for (const file of mdFiles) {
      const filePath = path.join(NOTES_DIR, file)
      const stats = await fs.promises.stat(filePath)
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const title = path.basename(file, '.md')

      results.push({
        title,
        tags: extractTags(content),
        links: extractLinks(content),
        updatedAt: stats.mtimeMs,
        size: stats.size,
        excerpt: buildExcerpt(content, title)
      })
    }

    // Sort by last updated (newest first)
    return results.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (err) {
    console.error('Failed to list markdown notes:', err)
    return []
  }
}

/**
 * Reads a single note's content by its title.
 */
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

/**
 * Writes or renames a note.
 *
 * When `oldTitle` is provided and differs from `title`, the note is renamed.
 * Renaming onto an existing, different note is refused so a rename can never
 * silently overwrite (and destroy) another note.
 */
export async function writeNote(title: string, content: string, oldTitle?: string): Promise<void> {
  initNotesFs()

  const trimmedTitle = title.trim()
  if (!trimmedTitle) {
    throw new Error('Note title cannot be empty')
  }

  try {
    const newPath = resolveSafePath(trimmedTitle)

    // Handle rename if oldTitle is provided and different
    if (oldTitle && oldTitle !== trimmedTitle) {
      const oldPath = resolveSafePath(oldTitle)
      // Refuse to clobber a different existing note during a rename.
      if (fs.existsSync(newPath) && newPath !== oldPath) {
        throw new Error(`A note titled "${trimmedTitle}" already exists`)
      }
      if (fs.existsSync(oldPath)) {
        await fs.promises.rename(oldPath, newPath)
      }
    }

    await fs.promises.writeFile(newPath, content, 'utf-8')
  } catch (err) {
    console.error(`Failed to write note "${title}":`, err)
    throw err
  }
}

/**
 * Deletes a note by its title.
 */
export async function deleteNote(title: string): Promise<void> {
  initNotesFs()
  try {
    const filePath = resolveSafePath(title)
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath)
    }
  } catch (err) {
    console.error(`Failed to delete note "${title}":`, err)
    throw err
  }
}

/**
 * Full-text search across all note bodies (and titles). Returns matches with a
 * contextual snippet around the first hit, ranked by relevance.
 */
export async function searchNotes(query: string): Promise<NoteSearchResult[]> {
  initNotesFs()
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return []

  try {
    const files = await fs.promises.readdir(NOTES_DIR)
    const mdFiles = files.filter(f => f.toLowerCase().endsWith('.md'))

    const results: NoteSearchResult[] = []

    for (const file of mdFiles) {
      const filePath = path.join(NOTES_DIR, file)
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const title = path.basename(file, '.md')

      const plain = toPlainText(content)
      const haystack = plain.toLowerCase()
      const titleMatch = title.toLowerCase().includes(trimmed)

      // Count body matches without regex (query may contain special chars).
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

    // Rank: title matches first, then by number of body matches.
    return results.sort((a, b) => {
      if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1
      return b.matchCount - a.matchCount
    })
  } catch (err) {
    console.error('Failed to search notes:', err)
    return []
  }
}
