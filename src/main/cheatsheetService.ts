import { app, dialog } from 'electron'

/** pdf-parse ships no types and changed shape across majors, all four export shapes described */
interface PdfParseResult {
  text?: string
  pages?: Array<{ text?: string }>
}

interface PdfParseInstance {
  load(): Promise<void>
  getText(): Promise<PdfParseResult | string>
}

interface PdfParseClass {
  new (data: Uint8Array): PdfParseInstance
  prototype?: { load?: unknown }
}

type PdfParseFunction = (data: Buffer) => Promise<PdfParseResult | undefined>

type PdfParseExport = Record<string, unknown> | PdfParseClass | PdfParseFunction | undefined
import { join, basename, extname } from 'path'
import { existsSync, promises as fs } from 'fs'

export function getCheatsheetsDir(): string {
  return join(app.getPath('userData'), 'cheatsheets')
}

export async function initCheatsheets(): Promise<void> {
  const dir = getCheatsheetsDir()
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true })
  }
}

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

    return results.sort((a, b) => b.mtime - a.mtime)
  } catch (err) {
    console.error('Failed to list cheatsheets:', err)
    return []
  }
}

/** counter suffix on name clash */
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

  while (existsSync(targetPath)) {
    targetName = `${baseNameWithoutExt} (${counter})${ext}`
    targetPath = join(dir, targetName)
    counter++
  }

  await fs.copyFile(srcPath, targetPath)
  return targetName
}

export async function renameCheatsheet(oldName: string, newName: string): Promise<void> {
  const dir = getCheatsheetsDir()
  const oldPath = join(dir, oldName)
  
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

export async function removeCheatsheet(name: string): Promise<void> {
  const dir = getCheatsheetsDir()
  const filePath = join(dir, name)

  if (existsSync(filePath)) {
    await fs.unlink(filePath)
  }
}

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

// parsing is slow and runs every AI turn, cache by file + mtime
const textCache = new Map<string, { mtime: number; text: string }>()

export async function getCheatsheetText(name: string): Promise<string> {
  const dir = getCheatsheetsDir()
  const filePath = join(dir, name)

  if (!existsSync(filePath)) {
    return ''
  }

  try {
    const stat = await fs.stat(filePath)
    const cached = textCache.get(filePath)
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.text
    }
  } catch { /* fall through to parse */ }

  const origWarn = console.warn
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('standardFontDataUrl')) return
    origWarn(...args)
  }

  let text = ''
  try {
    const dataBuffer = await fs.readFile(filePath)
    const uint8 = new Uint8Array(dataBuffer)
    // default export moved between majors, see the types above
    const pdfModule = await import('pdf-parse') as unknown as Record<string, unknown>
    const asRecord = (v: unknown): Record<string, unknown> | undefined =>
      v && typeof v === 'object' ? v as Record<string, unknown> : undefined

    const PDFParseClass: PdfParseExport =
      (pdfModule.PDFParse as PdfParseExport)
      ?? (asRecord(pdfModule.default)?.PDFParse as PdfParseExport)
      ?? (pdfModule.default as PdfParseExport)
      ?? pdfModule

    // class form has load() on its prototype; function form is called directly
    if (typeof PDFParseClass === 'function' && (PDFParseClass as PdfParseClass).prototype?.load) {
      const parser = new (PDFParseClass as PdfParseClass)(uint8)
      await parser.load()
      const res = await parser.getText()
      if (typeof res === 'string') {
        text = res
      } else if (res && Array.isArray(res.pages)) {
        text = res.pages.map(p => p.text || '').join('\n\n')
      } else if (res?.text) {
        text = res.text
      }
    } else if (typeof PDFParseClass === 'function') {
      const res = await (PDFParseClass as PdfParseFunction)(dataBuffer)
      text = res?.text || ''
    }
  } catch (err) {
    console.error(`Failed to parse PDF text for cheatsheet "${name}":`, err)
    text = ''
  } finally {
    console.warn = origWarn
  }

  try {
    const stat = await fs.stat(filePath)
    textCache.set(filePath, { mtime: stat.mtimeMs, text })
  } catch { /* ignore cache write failure */ }

  return text
}

interface CheatsheetSearchResult {
  name: string
  matchCount: number
  /** up to 3 */
  snippets: string[]
}

/** served from the mtime cache, repeats are cheap */
export async function searchCheatsheets(query: string): Promise<CheatsheetSearchResult[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []

  const sheets = await listCheatsheets()
  const results: CheatsheetSearchResult[] = []

  for (const sheet of sheets) {
    const text = await getCheatsheetText(sheet.name)
    if (!text) continue
    const lower = text.toLowerCase()

    let idx = 0
    let count = 0
    const snippets: string[] = []
    while ((idx = lower.indexOf(q, idx)) !== -1) {
      count++
      if (snippets.length < 3) {
        const start = Math.max(0, idx - 60)
        const end = Math.min(text.length, idx + q.length + 60)
        const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
        snippets.push(`${start > 0 ? '…' : ''}${snippet}${end < text.length ? '…' : ''}`)
      }
      idx += q.length
      if (count >= 500) break // enough signal; keep the scan bounded
    }

    if (count > 0) results.push({ name: sheet.name, matchCount: count, snippets })
  }

  return results.sort((a, b) => b.matchCount - a.matchCount)
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'are', 'was', 'have', 'has', 'not',
  'but', 'from', 'they', 'will', 'been', 'all', 'its', 'you', 'your', 'how', 'what',
  'can', 'should', 'would', 'about', 'into', 'when', 'which', 'their', 'them'
])

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(t => t.length > 2 && !STOP_WORDS.has(t))
}

function chunkText(text: string, targetChars = 900): string[] {
  const paras = text.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const chunks: string[] = []
  let buf = ''
  for (const p of paras) {
    if (buf.length + p.length + 1 > targetChars && buf) {
      chunks.push(buf)
      buf = ''
    }
    // hard-split huge paragraphs to keep chunks bounded
    if (p.length > targetChars * 1.6) {
      if (buf) { chunks.push(buf); buf = '' }
      for (let i = 0; i < p.length; i += targetChars) chunks.push(p.slice(i, i + targetChars))
    } else {
      buf = buf ? `${buf} ${p}` : p
    }
  }
  if (buf) chunks.push(buf)
  return chunks
}

/** whole doc if it fits, else TF-IDF ranked chunks restitched in doc order */
export async function getCheatsheetRelevant(name: string, query: string, maxChars = 8000): Promise<string> {
  const full = await getCheatsheetText(name)
  if (!full) return ''
  if (full.length <= maxChars) return full

  const queryTokens = tokenize(query || '')
  const chunks = chunkText(full)
  if (chunks.length === 0) return full.slice(0, maxChars)

  // no usable query: head of the doc, usually the summary
  if (queryTokens.length === 0) {
    return `${full.slice(0, maxChars).trim()}\n\n[… document truncated. Ask about a specific topic to surface deeper sections …]`
  }

  // idf over chunks
  const docFreq: Record<string, number> = {}
  const chunkTokens = chunks.map(c => {
    const toks = tokenize(c)
    for (const t of new Set(toks)) docFreq[t] = (docFreq[t] || 0) + 1
    return toks
  })
  const N = chunks.length
  const idf = (t: string): number => Math.log((N + 1) / ((docFreq[t] || 0) + 1)) + 1
  const querySet = new Set(queryTokens)

  const scored = chunks.map((chunk, i) => {
    const toks = chunkTokens[i]
    const tf: Record<string, number> = {}
    for (const t of toks) tf[t] = (tf[t] || 0) + 1
    const maxTf = Math.max(1, ...Object.values(tf))
    let score = 0
    for (const qt of querySet) {
      if (tf[qt]) score += (tf[qt] / maxTf) * idf(qt) * idf(qt)
    }
    return { i, chunk, score }
  })

  // best chunks until the budget's spent, then back to doc order
  const ranked = [...scored].filter(s => s.score > 0).sort((a, b) => b.score - a.score)
  const picked: typeof ranked = []
  let used = 0
  for (const s of ranked) {
    if (used + s.chunk.length > maxChars) continue
    picked.push(s)
    used += s.chunk.length + 4
    if (used >= maxChars) break
  }
  // nothing matched, fall back to the head
  if (picked.length === 0) {
    return `${full.slice(0, maxChars).trim()}\n\n[… document truncated …]`
  }

  picked.sort((a, b) => a.i - b.i)
  const body = picked.map(p => p.chunk).join('\n\n[…]\n\n')
  return `[Relevant excerpts selected for your question]\n\n${body}`
}

