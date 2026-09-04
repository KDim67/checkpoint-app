/**
 * Copying an Obsidian vault into the notes folder.
 *
 * The walking, copying and writing. Everything that decides what a note should
 * end up looking like is in `shared/obsidianImport.ts`, where it can be tested
 * without a vault on disk.
 *
 * Nothing in the vault is touched. This only ever reads.
 */

import { join, relative, extname, basename, sep } from 'path'
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import {
  isSkippedPath,
  planTitles,
  baseTitle,
  collectAttachmentTargets,
  convertNote,
  type VaultImportResult
} from '../shared/obsidianImport'
import { getNotesDir, getMediaDir, ensureDir, resolveSafePath } from './paths'

/** Stop before a runaway walk: a vault is notes, not a whole home directory. */
const MAX_FILES = 20000

/** Every file under `root`, as vault-relative paths with forward slashes. */
function walk(root: string): string[] {
  const found: string[] = []

  const visit = (dir: string): void => {
    if (found.length >= MAX_FILES) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch (err) {
      console.error(`[obsidian] Could not read ${dir}:`, err)
      return
    }

    for (const entry of entries) {
      const full = join(dir, entry)
      const rel = relative(root, full).split(sep).join('/')
      if (isSkippedPath(rel)) continue

      let stats: ReturnType<typeof statSync>
      try {
        stats = statSync(full)
      } catch {
        // A broken symlink or a file that vanished mid-walk.
        continue
      }

      if (stats.isDirectory()) visit(full)
      else if (stats.isFile()) found.push(rel)
      if (found.length >= MAX_FILES) return
    }
  }

  visit(root)
  return found
}

const isMarkdown = (path: string): boolean => /\.md$/i.test(path)

/**
 * Resolves an attachment as a note wrote it.
 *
 * Obsidian lets an embed name just the file, wherever it lives in the vault,
 * so a bare name is matched against every non-note file before giving up.
 */
function resolveAttachment(target: string, files: string[]): string | null {
  const wanted = target.split(/[\\/]/).join('/')
  const direct = files.find(f => f.toLowerCase() === wanted.toLowerCase())
  if (direct) return direct

  const name = wanted.split('/').pop()?.toLowerCase()
  if (!name) return null
  return files.find(f => (f.split('/').pop() ?? '').toLowerCase() === name) ?? null
}

export function importObsidianVault(vaultPath: string): VaultImportResult {
  const result: VaultImportResult = {
    notesImported: 0,
    notesOverwritten: 0,
    attachmentsCopied: 0,
    renamed: [],
    notes: []
  }

  if (!existsSync(vaultPath)) throw new Error('That folder no longer exists.')

  ensureDir(getNotesDir())

  const files = walk(vaultPath)
  if (files.length >= MAX_FILES) {
    result.notes.push(`Stopped after ${MAX_FILES} files. Is that folder a vault, or something larger?`)
  }

  const markdown = files.filter(isMarkdown)
  if (markdown.length === 0) throw new Error('No Markdown files in that folder.')

  const attachmentCandidates = files.filter(f => !isMarkdown(f))
  const titles = planTitles(markdown)

  // Only the notes whose title changed need their inbound links repointed.
  const renamed = new Map<string, string>()
  for (const [path, title] of titles) {
    const original = baseTitle(path)
    if (original !== title) {
      renamed.set(original.toLowerCase(), title)
      result.renamed.push({ from: original, to: title })
    }
  }

  /** Vault path of an attachment → the media filename it was copied to. */
  const copied = new Map<string, string>()
  const frontmatterKeys = new Set<string>()
  let unresolved = 0

  for (const path of markdown) {
    const title = titles.get(path)
    if (!title) continue

    let raw: string
    try {
      raw = readFileSync(join(vaultPath, path), 'utf8')
    } catch (err) {
      console.error(`[obsidian] Could not read ${path}:`, err)
      continue
    }

    // Attachments are copied as they are met, so a vault of images nobody
    // links to does not end up in the media folder.
    const resolved = new Map<string, string>()
    for (const target of collectAttachmentTargets(raw)) {
      const source = resolveAttachment(target, attachmentCandidates)
      if (!source) { unresolved++; continue }

      let filename = copied.get(source)
      if (!filename) {
        filename = `${uuidv4()}${extname(source)}`
        try {
          ensureDir(getMediaDir())
          copyFileSync(join(vaultPath, source), join(getMediaDir(), filename))
          copied.set(source, filename)
          result.attachmentsCopied++
        } catch (err) {
          console.error(`[obsidian] Could not copy ${source}:`, err)
          unresolved++
          continue
        }
      }
      resolved.set(target, filename)
    }

    const converted = convertNote(raw, renamed, resolved)
    converted.frontmatterKeys.forEach(key => frontmatterKeys.add(key))

    try {
      // Through the same helper the notes UI uses, so an import cannot write
      // anywhere a hand-typed title could not.
      const destination = resolveSafePath(getNotesDir(), title, '.md')
      if (existsSync(destination)) result.notesOverwritten++
      writeFileSync(destination, converted.content, 'utf8')
      result.notesImported++
    } catch (err) {
      console.error(`[obsidian] Could not write ${title}:`, err)
    }
  }

  if (result.renamed.length > 0) {
    const sample = result.renamed.slice(0, 3).map(r => `"${r.from}" → "${r.to}"`).join(', ')
    result.notes.push(
      `${result.renamed.length} note${result.renamed.length === 1 ? '' : 's'} shared a name and were renamed (${sample}). Links to them were repointed.`
    )
  }
  if (result.notesOverwritten > 0) {
    result.notes.push(`${result.notesOverwritten} existing note${result.notesOverwritten === 1 ? ' was' : 's were'} overwritten.`)
  }
  if (unresolved > 0) {
    result.notes.push(`${unresolved} embedded file${unresolved === 1 ? '' : 's'} could not be found in the vault and were left as they were.`)
  }

  const dropped = [...frontmatterKeys].filter(k => k.toLowerCase() !== 'tags' && k.toLowerCase() !== 'tag')
  if (dropped.length > 0) {
    result.notes.push(`Frontmatter was removed. Tags were kept as #tags; ${dropped.slice(0, 5).join(', ')} had nowhere to go.`)
  }

  return result
}

/** The vault's own name, offered as a label in the confirmation. */
export function vaultName(vaultPath: string): string {
  return basename(vaultPath) || 'Vault'
}
