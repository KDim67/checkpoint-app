import { app, dialog } from 'electron'
import { join, basename, extname } from 'path'
import { existsSync, promises as fs } from 'fs'

/**
 * Returns the path to the cheatsheets folder inside the application's userData directory.
 */
export function getCheatsheetsDir(): string {
  return join(app.getPath('userData'), 'cheatsheets')
}

/**
 * Ensures the cheatsheets directory exists on disk.
 */
export async function initCheatsheets(): Promise<void> {
  const dir = getCheatsheetsDir()
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true })
  }
}

/**
 * Lists all PDF cheatsheets in the directory.
 */
export async function listCheatsheets(): Promise<Array<{ name: string; path: string; size: number; mtime: number }>> {
  const dir = getCheatsheetsDir()
  await initCheatsheets()

  try {
    const files = await fs.readdir(dir)
    const results: Array<{ name: string; path: string; size: number; mtime: number }> = []

    for (const file of files) {
      if (extname(file).toLowerCase() === '.pdf') {
        const filePath = join(dir, file)
        try {
          const stat = await fs.stat(filePath)
          results.push({
            name: file,
            path: filePath,
            size: stat.size,
            mtime: stat.mtimeMs
          })
        } catch (statErr) {
          console.error(`Failed to stat cheatsheet file: ${file}`, statErr)
        }
      }
    }

    // Sort by modification time descending (newest first)
    return results.sort((a, b) => b.mtime - a.mtime)
  } catch (err) {
    console.error('Failed to list cheatsheets:', err)
    return []
  }
}

/**
 * Safely copy a PDF from an external location to the cheatsheets directory.
 * If a name collision occurs, appends a counter suffix.
 */
export async function addCheatsheet(srcPath: string): Promise<string> {
  await initCheatsheets()
  const dir = getCheatsheetsDir()
  
  const originalName = basename(srcPath)
  let ext = extname(originalName)
  if (ext.toLowerCase() !== '.pdf') {
    throw new Error('Only PDF files are supported.')
  }
  
  const baseNameWithoutExt = basename(originalName, ext)
  
  let targetName = originalName
  let targetPath = join(dir, targetName)
  let counter = 1

  // Loop to find a unique filename
  while (existsSync(targetPath)) {
    targetName = `${baseNameWithoutExt} (${counter})${ext}`
    targetPath = join(dir, targetName)
    counter++
  }

  await fs.copyFile(srcPath, targetPath)
  return targetName
}

/**
 * Safely renames a cheatsheet.
 */
export async function renameCheatsheet(oldName: string, newName: string): Promise<void> {
  const dir = getCheatsheetsDir()
  const oldPath = join(dir, oldName)
  
  // Clean newName and ensure .pdf extension
  let cleanNewName = newName.trim()
  if (!cleanNewName) {
    throw new Error('Cheatsheet name cannot be empty.')
  }
  if (extname(cleanNewName).toLowerCase() !== '.pdf') {
    cleanNewName += '.pdf'
  }

  const newPath = join(dir, cleanNewName)

  if (!existsSync(oldPath)) {
    throw new Error(`Source cheatsheet does not exist: ${oldName}`)
  }

  if (oldName !== cleanNewName && existsSync(newPath)) {
    throw new Error(`A cheatsheet named "${cleanNewName}" already exists.`)
  }

  await fs.rename(oldPath, newPath)
}

/**
 * Deletes a cheatsheet from disk.
 */
export async function removeCheatsheet(name: string): Promise<void> {
  const dir = getCheatsheetsDir()
  const filePath = join(dir, name)

  if (existsSync(filePath)) {
    await fs.unlink(filePath)
  }
}

/**
 * Opens a native file dialog to let the user select a PDF file.
 */
export async function selectFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select PDF Cheatsheet',
    properties: ['openFile'],
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
}

/**
 * Reads and extracts full text content from a PDF cheatsheet on disk.
 */
export async function getCheatsheetText(name: string): Promise<string> {
  const dir = getCheatsheetsDir()
  const filePath = join(dir, name)

  if (!existsSync(filePath)) {
    return ''
  }

  const origWarn = console.warn
  console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('standardFontDataUrl')) return
    origWarn(...args)
  }

  try {
    const dataBuffer = await fs.readFile(filePath)
    const uint8 = new Uint8Array(dataBuffer)
    const pdfModule: any = await import('pdf-parse')
    const PDFParseClass = pdfModule.PDFParse || pdfModule.default?.PDFParse || pdfModule.default || pdfModule
    
    if (typeof PDFParseClass === 'function' && PDFParseClass.prototype?.load) {
      const parser = new PDFParseClass(uint8)
      await parser.load()
      const res = await parser.getText()
      if (res && Array.isArray(res.pages)) {
        return res.pages.map((p: any) => p.text || '').join('\n\n')
      } else if (typeof res === 'string') {
        return res
      } else if (res?.text) {
        return res.text
      }
    } else if (typeof PDFParseClass === 'function') {
      const res = await PDFParseClass(dataBuffer)
      return res?.text || ''
    }
    return ''
  } catch (err) {
    console.error(`Failed to parse PDF text for cheatsheet "${name}":`, err)
    return ''
  } finally {
    console.warn = origWarn
  }
}

