import { join, extname } from 'path'
import { existsSync, readdirSync, writeFileSync, copyFileSync, statSync, unlinkSync, readFileSync } from 'fs'
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
import { removePreviewsFor, warmPreviews } from './mediaPreview'
import { getMediaDir, getNotesDir, ensureDir } from './paths'

export function ensureMediaDir(): void {
  ensureDir(getMediaDir())
}

export function saveBufferToMedia(buffer: Buffer, extension: string): string {
  ensureMediaDir()
  const cleanExt = extension.startsWith('.') ? extension : `.${extension}`
  const filename = `${uuidv4()}${cleanExt}`
  const filePath = join(getMediaDir(), filename)
  writeFileSync(filePath, buffer)
  // scaled now, not on first view (see warmPreviews)
  warmPreviews(filePath)
  return filename
}

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
      warmPreviews(destPath)
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

/** walks the schema, not a table list: walls in app_settings were missed and their images pruned */
export function collectDbTexts(db: Database.Database): string[] {
  const texts: string[] = []

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>

  for (const { name } of tables) {
    // FTS copies items columns, and its shadow tables are packed blobs
    if (name.includes('_fts')) continue

    try {
      const columns = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string; type: string }>
      // include untyped columns, SQLite still stores text in them
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
      // one unreadable table mustn't make everything look orphaned
      console.error(`[mediaService] Could not scan table ${name} for references:`, err)
    }
  }

  return texts
}

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

  const dbTexts = collectDbTexts(getDb())

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

  for (const filename of files) {
    const isReferenced = allTexts.some(text => text.includes(filename))
    
    if (!isReferenced) {
      const filePath = join(mediaDir, filename)
      try {
        const stats = statSync(filePath)
        const size = stats.size
        unlinkSync(filePath)
        
        results.prunedCount++
        // previews go too, nothing else could reach them
        results.spaceSavedBytes += size + removePreviewsFor(filename)
        results.prunedFiles.push(filename)
      } catch (err) {
        console.error(`[mediaService] Failed to delete orphaned media: ${filename}`, err)
      }
    }
  }

  return results
}

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
