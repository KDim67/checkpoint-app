import fs from 'fs'
import path from 'path'
import os from 'os'
import type { NoteMetadata } from '../shared/types'

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
  if (!resolvedPath.startsWith(NOTES_DIR)) {
    throw new Error('Path traversal detected')
  }
  return resolvedPath
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

      // Parse tags: #tagname (must be preceded by whitespace or start of line,
      // and followed by word boundary or whitespace)
      const tagMatches = content.match(/(?:^|\s)(#[a-zA-Z0-9_-]+)/g) || []
      const tags = Array.from(
        new Set(
          tagMatches
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 1) // filter out solitary '#' characters
        )
      )

      // Parse [[wiki-links]]
      const linkMatches = content.matchAll(/\[\[([^\]]+)\]\]/g)
      const links = Array.from(
        new Set(
          Array.from(linkMatches).map(m => m[1].trim())
        )
      )

      const title = path.basename(file, '.md')

      results.push({
        title,
        tags,
        links,
        updatedAt: stats.mtimeMs,
        size: stats.size
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
 */
export async function writeNote(title: string, content: string, oldTitle?: string): Promise<void> {
  initNotesFs()
  try {
    const newPath = resolveSafePath(title)

    // Handle rename if oldTitle is provided and different
    if (oldTitle && oldTitle !== title) {
      const oldPath = resolveSafePath(oldTitle)
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
