import { join, extname } from 'path'
import { existsSync, readdirSync, writeFileSync, copyFileSync, statSync, unlinkSync, readFileSync } from 'fs'
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
import { removePreviewsFor } from './mediaPreview'
import { getMediaDir, getNotesDir, ensureDir } from './paths'

export function ensureMediaDir(): void {
  ensureDir(getMediaDir())
}

/**
 * Saves a binary buffer (from pasted clipboard image) to the media directory.
 * Generates a unique UUID-based filename to prevent collisions.
 * Returns the final filename.
 */
export function saveBufferToMedia(buffer: Buffer, extension: string): string {
  ensureMediaDir()
  const cleanExt = extension.startsWith('.') ? extension : `.${extension}`
  const filename = `${uuidv4()}${cleanExt}`
  const filePath = join(getMediaDir(), filename)
  writeFileSync(filePath, buffer)
  return filename
}

/**
 * Copies a list of local files (from drag & drop) into the media directory.
 * Generates unique filenames for each file.
 * Returns a list of mappings of original paths to new checkpoint-media URLs.
 */
export function saveFilesToMedia(filePaths: string[]): Array<{ originalPath: string; filename: string }> {
  ensureMediaDir()
  const results: Array<{ originalPath: string; filename: string }> = []
  
  for (const srcPath of filePaths) {
    if (!existsSync(srcPath)) continue
    
    const ext = extname(srcPath)
    const filename = `${uuidv4()}${ext}`
    const destPath = join(getMediaDir(), filename)
    
    try {
      copyFileSync(srcPath, destPath)
      results.push({
        originalPath: srcPath,
        filename
      })
    } catch (err) {
      console.error(`[mediaService] Failed to copy file: ${srcPath}`, err)
    }
  }
  
  return results
}

interface PruneResult {
  scannedCount: number
  prunedCount: number
  spaceSavedBytes: number
  prunedFiles: string[]
}

/**
 * Every stored string that could name a media file.
 *
 * Walks the schema rather than a list of tables. This feeds a delete, so a
 * table left out costs the user their files, and that is not hypothetical:
 * walls live in `app_settings`, which the hand-written list did not include,
 * so every image on every wall counted as an orphan and got removed.
 */
export function collectDbTexts(db: Database.Database): string[] {
  const texts: string[] = []

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>

  for (const { name } of tables) {
    // The full-text index copies columns out of `items`, which is read anyway,
    // and its shadow tables hold packed blobs rather than readable text.
    if (name.includes('_fts')) continue

    try {
      const columns = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string; type: string }>
      // Untyped columns included: SQLite lets a column have no declared type,
      // and it still holds whatever was put in it.
      const textColumns = columns
        .filter(c => c.type === '' || /CHAR|CLOB|TEXT|JSON|BLOB/i.test(c.type))
        .map(c => c.name)
      if (textColumns.length === 0) continue

      const quoted = textColumns.map(c => `"${c}"`).join(', ')
      const rows = db.prepare(`SELECT ${quoted} FROM "${name}"`).all() as Array<Record<string, unknown>>
      for (const row of rows) {
        for (const column of textColumns) {
          const value = row[column]
          if (typeof value === 'string' && value !== '') texts.push(value)
        }
      }
    } catch (err) {
      // One unreadable table must not make everything else look orphaned.
      console.error(`[mediaService] Could not scan table ${name} for references:`, err)
    }
  }

  return texts
}

/**
 * Scans the database and the Markdown notes directory to find any media files
 * that are no longer referenced, and safely deletes them.
 */
export function scanAndPruneOrphanedMedia(): PruneResult {
  ensureMediaDir()

  const mediaDir = getMediaDir()
  const files = readdirSync(mediaDir)
  const results: PruneResult = {
    scannedCount: files.length,
    prunedCount: 0,
    spaceSavedBytes: 0,
    prunedFiles: []
  }

  if (files.length === 0) {
    return results
  }

  // 1. Scan SQLite DB
  const dbTexts = collectDbTexts(getDb())

  // 2. Scan Markdown Notes Folder
  const notesDir = getNotesDir()
  const noteTexts: string[] = []
  if (existsSync(notesDir)) {
    try {
      const noteFiles = readdirSync(notesDir)
      for (const noteFile of noteFiles) {
        if (extname(noteFile).toLowerCase() === '.md') {
          const notePath = join(notesDir, noteFile)
          try {
            const content = readFileSync(notePath, 'utf8')
            noteTexts.push(content)
          } catch (e) {
            console.error(`[mediaService] Failed to read note: ${noteFile}`, e)
          }
        }
      }
    } catch (e) {
      console.error('[mediaService] Failed to read notes directory', e)
    }
  }

  const allTexts = [...dbTexts, ...noteTexts]

  // 3. For each file in media directory, check if its filename is referenced
  for (const filename of files) {
    const isReferenced = allTexts.some(text => text.includes(filename))
    
    if (!isReferenced) {
      const filePath = join(mediaDir, filename)
      try {
        const stats = statSync(filePath)
        const size = stats.size
        unlinkSync(filePath)
        
        results.prunedCount++
        // Its scaled copies go with it: they are only reachable through the
        // original, so once that is gone nothing would ever remove them.
        results.spaceSavedBytes += size + removePreviewsFor(filename)
        results.prunedFiles.push(filename)
      } catch (err) {
        console.error(`[mediaService] Failed to delete orphaned media: ${filename}`, err)
      }
    }
  }

  return results
}

/**
 * Retrieves storage metadata from the local media directory (count, size, path).
 */
export function getStorageInfo(): { fileCount: number; totalSize: number; path: string } {
  ensureMediaDir()
  const dir = getMediaDir()
  try {
    const files = readdirSync(dir)
    let totalSize = 0
    for (const file of files) {
      try {
        const stat = statSync(join(dir, file))
        totalSize += stat.size
      } catch {
        // ignore
      }
    }
    return { fileCount: files.length, totalSize, path: dir }
  } catch (err) {
    console.error('[mediaService] Failed to read storage info:', err)
    return { fileCount: 0, totalSize: 0, path: dir }
  }
}
