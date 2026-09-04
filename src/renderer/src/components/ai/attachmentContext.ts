/**
 * Everything the user attached, fetched and turned into system messages.
 *
 * The part worth noticing is that each source has a size budget, which is what
 * stops one attached PDF evicting the whole conversation from the context
 * window. Blocks moved verbatim; only the budget arithmetic is pulled out.
 */

import type { Message } from './types'

export type SystemMessage = { role: 'system'; content: string }

/**
 * Characters of cheatsheet text to request per attached document.
 *
 * Split across the attached sheets rather than given to each, so attaching five
 * documents does not ask for five times the budget. The floor of 1500 means a
 * sheet is never quoted so thinly that it says nothing.
 */
export function cheatsheetBudget(
  isSmallModel: boolean,
  contextWindowTokens: number,
  sheetCount: number
): number {
  const totalBudget = isSmallModel ? 6000 : Math.min(60000, Math.round(contextWindowTokens * 1.2))
  return Math.max(1500, Math.floor(totalBudget / Math.max(1, sheetCount)))
}

/** Per-note and per-file caps. Small models get less of everything. */
export function noteCap(isSmallModel: boolean): number {
  return isSmallModel ? 3000 : 9000
}
export function fileCap(isSmallModel: boolean): number {
  return isSmallModel ? 4000 : 12000
}

/**
 * Attachments accumulate across the whole conversation, not just the last
 * message: a document attached five turns ago is still what the user is asking
 * about.
 */
export function collectAttachments(messages: Message[]): {
  cheatsheets: string[]
  notes: string[]
  files: string[]
} {
  const allActiveCheatsheets = new Set<string>()
  const allActiveNotes = new Set<string>()
  const allActiveFiles = new Set<string>()
  messages.forEach(m => {
    if (Array.isArray(m.cheatsheets)) m.cheatsheets.forEach(cs => allActiveCheatsheets.add(cs))
    if (Array.isArray(m.notes)) m.notes.forEach(n => allActiveNotes.add(n))
    if (Array.isArray(m.files)) m.files.forEach(f => allActiveFiles.add(f))
  })
  return {
    cheatsheets: [...allActiveCheatsheets],
    notes: [...allActiveNotes],
    files: [...allActiveFiles]
  }
}

interface Options {
  messages: Message[]
  /** The user's latest question, used to pull only relevant passages. */
  text: string
  isSmallModel: boolean
  contextWindowTokens: number
  workspaceFolder: string | null
}

/** Reads every attachment and returns the system messages to inject, in order. */
export async function gatherAttachmentMessages({
  messages,
  text,
  isSmallModel,
  contextWindowTokens,
  workspaceFolder
}: Options): Promise<SystemMessage[]> {
  const { cheatsheets: sheets, notes: noteTitles, files: filePaths } = collectAttachments(messages)
  const allActiveCheatsheets = new Set(sheets)
  const allActiveNotes = new Set(noteTitles)
  const allActiveFiles = new Set(filePaths)
  const apiMessages: SystemMessage[] = []

  // Attach reference-document text as a system knowledge base. Rather than
  // dumping every full PDF (which floods a small model's context and buries
  // the relevant part), pull only the passages relevant to the user's
  // question, sized to the model's context window and split across sheets.
  if (allActiveCheatsheets.size > 0) {
    const sheetNames = Array.from(allActiveCheatsheets)
    const perSheet = cheatsheetBudget(isSmallModel, contextWindowTokens, sheetNames.length)
    let fullDocText = ''
    for (const sheetName of sheetNames) {
      try {
        const relevant = await window.electronAPI.cheatsheets.getRelevant(sheetName, text, perSheet)
        const cleanText = (relevant || '').trim()
        if (cleanText) {
          fullDocText += `\n\n=== ATTACHED CHEATSHEET / REFERENCE DOCUMENT: "${sheetName}" ===\n${cleanText}\n=== END OF DOCUMENT: "${sheetName}" ===\n`
        }
      } catch (pdfErr) {
        console.warn(`Failed to read cheatsheet text for ${sheetName}:`, pdfErr)
      }
    }
    if (fullDocText) {
      apiMessages.push({
        role: 'system',
        content: `CRITICAL KNOWLEDGE BASE DOCUMENTS:\nThe following reference documents have been uploaded and attached by the user. You HAVE full access to these documents below. Do NOT ask the user to provide or upload the PDF file again, because it is ALREADY provided right here:\n${fullDocText}`
      })
    }
  }

  // Attached NOTES (from the Notes feature). Full content, size-capped
  if (allActiveNotes.size > 0) {
    const perNoteCap = noteCap(isSmallModel)
    let notesText = ''
    for (const noteTitle of Array.from(allActiveNotes)) {
      try {
        const content = await window.electronAPI.notes.readNote(noteTitle)
        const clean = (content || '').trim().slice(0, perNoteCap)
        if (clean) notesText += `\n\n=== ATTACHED NOTE: "${noteTitle}" ===\n${clean}\n=== END OF NOTE ===\n`
      } catch (noteErr) {
        console.warn(`Failed to read note "${noteTitle}":`, noteErr)
      }
    }
    if (notesText) {
      apiMessages.push({
        role: 'system',
        content: `USER'S PROJECT NOTES (attached by the user: you HAVE their full content below):${notesText}`
      })
    }
  } else if (text.length > 12) {
    // Auto-recall: no notes attached. Surface the 2 most relevant note
    // snippets so lore/design decisions written in Notes stay consistent.
    try {
      const hits = await window.electronAPI.notes.searchNotes(text)
      const top = (hits || []).slice(0, 2).filter(h => h.snippet && h.snippet.trim())
      if (top.length > 0) {
        const recall = top.map(h => `- Note "${h.title}": …${h.snippet.trim().slice(0, 280)}…`).join('\n')
        apiMessages.push({
          role: 'system',
          content: `RELEVANT PROJECT NOTES (auto-recalled snippets: the user can attach the full note with @):\n${recall}`
        })
      }
    } catch { /* auto-recall is best-effort */ }
  }

  // Attached WORKSPACE FILES. Actual source contents, size-capped
  if (allActiveFiles.size > 0 && workspaceFolder) {
    const perFileCap = fileCap(isSmallModel)
    let filesText = ''
    for (const relPath of Array.from(allActiveFiles)) {
      try {
        const content = await window.electronAPI.workspace.readFile(workspaceFolder, relPath)
        const clean = (content || '').trim().slice(0, perFileCap)
        if (clean) filesText += `\n\n=== ATTACHED FILE: "${relPath}" ===\n\`\`\`\n${clean}\n\`\`\`\n=== END OF FILE ===\n`
      } catch (fileErr) {
        console.warn(`Failed to read workspace file "${relPath}":`, fileErr)
      }
    }
    if (filesText) {
      apiMessages.push({
        role: 'system',
        content: `WORKSPACE SOURCE FILES (attached by the user: you HAVE their contents below):${filesText}`
      })
    }
  }

  return apiMessages
}
