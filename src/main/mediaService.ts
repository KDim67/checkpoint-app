import { join, extname } from 'path'
import { existsSync, readdirSync, writeFileSync, copyFileSync, statSync, unlinkSync, readFileSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
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
 * Scans the database items (logs, cards, tasks) and Markdown notes directory
 * to find any media files that are no longer referenced, and safely deletes them.
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
  const db = getDb()
  
  // Get all references in items table (title, body, metadata)
  const items = db.prepare('SELECT title, body, metadata FROM items').all() as Array<{
    title: string
    body: string
    metadata: string
  }>
  
  // Get references in clipboard_items
  let clipboardItems: Array<{ content: string }> = []
  try {
    clipboardItems = db.prepare('SELECT content FROM clipboard_items').all() as Array<{ content: string }>
  } catch {
    // clipboard table might not exist in older versions, ignore
  }

  // Gather all text fields from DB
  const dbTexts: string[] = []
  for (const item of items) {
    dbTexts.push(item.title || '')
    dbTexts.push(item.body || '')
    dbTexts.push(item.metadata || '')
  }
  for (const clip of clipboardItems) {
    dbTexts.push(clip.content || '')
  }

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
        results.spaceSavedBytes += size
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
