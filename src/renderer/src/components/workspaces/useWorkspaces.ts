/** the workspace list and every change to it; the Workspaces page owns them now that Settings no longer does */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useFailureReport, useToast } from '../ui/Toast'
import { applyImportedBoard, createWorkspace, setWorkspaceShared, slugifyWorkspace, WORKSPACE_COLORS, type WorkspaceEntry } from '../../lib/createWorkspace'
import { DEFAULT_TEMPLATE_ID } from '../../../../shared/projectTemplates'
import { readWorkspaceList, writeWorkspaceList } from '../../lib/workspaceList'
import { hidden, movedBy, movedTo, nextColor, replaced, restored } from '../../lib/workspaceEdits'
import { exportContext, importContext, importContextData, renameContext } from '../../data/workspaces'
import { errorMessage } from '../../../../shared/errors'
import type { ContextExport } from '../../../../shared/types'
import type { ImportedBoard } from '../../../../shared/foreignImport'

/** a change the form can show next to its field, or done */
export type Outcome = { ok: true } | { ok: false; reason: string }

export interface WorkspaceFields {
  name: string
  color: string
  gitPath: string
  /** edit only: the #slug, which moves the workspace's data when it changes */
  slug?: string
  /** new only */
  templateId?: string
  /** a stored picture's name; empty or left out for the letter */
  icon?: string
}

/** a file picked and read, waiting for a name before anything is written */
export type ImportDraft =
  | { kind: 'checkpoint'; payload: ContextExport; name: string }
  | { kind: 'board'; board: ImportedBoard; name: string }

const titled = (slug: string): string => slug.charAt(0).toUpperCase() + slug.slice(1)

export function useWorkspaces() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setWorkspace = useAppStore(s => s.setWorkspace)
  const availableWorkspaces = useAppStore(s => s.availableWorkspaces)
  const setAvailableWorkspaces = useAppStore(s => s.setAvailableWorkspaces)
  const setWorkspaceList = useAppStore(s => s.setWorkspaceList)
  const { toast } = useToast()
  const report = useFailureReport()

  const [list, setList] = useState<WorkspaceEntry[]>([])
  const [loading, setLoading] = useState(true)
  // quick key presses each read the list the last one left, not the render they started in
  const listRef = useRef<WorkspaceEntry[]>([])

  const show = useCallback((next: WorkspaceEntry[]) => {
    listRef.current = next
    setList(next)
    setAvailableWorkspaces(next.map(entry => entry.slug))
    setWorkspaceList(next)
  }, [setAvailableWorkspaces, setWorkspaceList])

  const persist = useCallback(async (next: WorkspaceEntry[]) => {
    await writeWorkspaceList(next)
    show(next)
  }, [show])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const stored = await readWorkspaceList()
        if (cancelled) return
        if (stored.length > 0) {
          show(stored)
        } else {
          // an install from before the list existed only knows its slugs
          await persist(availableWorkspaces.map((slug, i) => ({ slug, name: titled(slug), color: WORKSPACE_COLORS[i % WORKSPACE_COLORS.length] })))
        }
      } catch (err) {
        report('load the workspaces', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // read once on arrival; later changes come through this hook
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const create = useCallback(async (fields: WorkspaceFields): Promise<Outcome & { slug?: string }> => {
    const name = fields.name.trim()
    const slug = slugifyWorkspace(name)
    if (!slug) return { ok: false, reason: 'Give it a name with at least one letter or number.' }
    if (listRef.current.some(entry => entry.slug === slug)) return { ok: false, reason: `There's already a workspace called "${slug}".` }
    try {
      const entry: WorkspaceEntry = { slug, name, color: fields.color, gitPath: fields.gitPath.trim() || undefined, icon: fields.icon || undefined }
      const { list: next, summary, templateFailed } = await createWorkspace(listRef.current, entry, fields.templateId ?? DEFAULT_TEMPLATE_ID)
      show(next)
      if (templateFailed) toast(`Created ${name}, but its template couldn't be applied.`, { type: 'warning' })
      else toast(summary || `Created ${name}`, { type: 'success' })
      return { ok: true, slug }
    } catch (err) {
      return { ok: false, reason: `Couldn't create it: ${errorMessage(err)}` }
    }
  }, [show, toast])

  const update = useCallback(async (slug: string, fields: WorkspaceFields): Promise<Outcome> => {
    const current = listRef.current.find(entry => entry.slug === slug)
    if (!current) return { ok: false, reason: 'That workspace is no longer in the list.' }
    const name = fields.name.trim()
    if (!name) return { ok: false, reason: 'Give it a name.' }
    const nextSlug = slugifyWorkspace(fields.slug ?? '') || slugifyWorkspace(name)
    if (!nextSlug) return { ok: false, reason: 'The short name needs at least one letter or number.' }
    if (nextSlug !== slug && listRef.current.some(entry => entry.slug === nextSlug)) {
      return { ok: false, reason: `There's already a workspace called "${nextSlug}".` }
    }
    try {
      if (nextSlug !== slug) {
        const res = await renameContext(slug, nextSlug)
        if (res?.error) return { ok: false, reason: `Couldn't move it to "${nextSlug}": ${res.error}` }
        if (activeWorkspace === slug) setWorkspace(nextSlug)
      }
      await persist(replaced(listRef.current, slug, { ...current, slug: nextSlug, name, color: fields.color, gitPath: fields.gitPath.trim() || undefined, icon: fields.icon || undefined }))
      toast('Saved', { type: 'success' })
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: `Couldn't save it: ${errorMessage(err)}` }
    }
  }, [activeWorkspace, persist, setWorkspace, toast])

  /** its items stay in the database; Undo puts it back where it was */
  const remove = useCallback(async (slug: string): Promise<void> => {
    const entry = listRef.current.find(e => e.slug === slug)
    if (!entry || listRef.current.length < 2) return
    const { list: next, index } = hidden(listRef.current, slug)
    try {
      await persist(next)
      if (activeWorkspace === slug) setWorkspace(next[0].slug)
      toast(`Removed ${entry.name}`, {
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: () => { persist(restored(listRef.current, entry, index)).catch(err => report('put the workspace back', err)) }
        }
      })
    } catch (err) {
      report('remove the workspace', err)
    }
  }, [activeWorkspace, persist, report, setWorkspace, toast])

  /** only the label, it was never a mode */
  const unshare = useCallback(async (slug: string): Promise<void> => {
    const next = setWorkspaceShared(listRef.current, slug, false)
    if (next === listRef.current) return
    await persist(next).catch(err => report('clear the shared label', err))
  }, [persist, report])

  const move = useCallback(async (slug: string, by: -1 | 1): Promise<void> => {
    const next = movedBy(listRef.current, slug, by)
    if (next === listRef.current) return
    await persist(next).catch(err => report('move the workspace', err))
  }, [persist, report])

  const moveTo = useCallback(async (from: number, to: number): Promise<void> => {
    const next = movedTo(listRef.current, from, to)
    if (next === listRef.current) return
    await persist(next).catch(err => report('move the workspace', err))
  }, [persist, report])

  const exportOne = useCallback(async (entry: WorkspaceEntry): Promise<void> => {
    try {
      const res = await exportContext(entry.slug, entry.name)
      if (res.success && res.filePath) toast(`Exported to ${res.filePath.split(/[\\/]/).pop()}`, { type: 'success' })
      else if (res.error) toast(`Could not export it: ${res.error}`, { type: 'error' })
    } catch (err) {
      report('export the workspace', err)
    }
  }, [report, toast])

  /** the file is read first; nothing is written until its name is confirmed */
  const startImport = useCallback(async (): Promise<ImportDraft | null> => {
    try {
      const res = await importContext()
      if (res.success && res.payload) return { kind: 'checkpoint', payload: res.payload, name: titled(res.payload.context) }
      if (res.success && res.foreign) return { kind: 'board', board: res.foreign, name: res.foreign.name }
      if (res.error) toast(`Could not import it: ${res.error}`, { type: 'error' })
    } catch (err) {
      report('import the file', err)
    }
    return null
  }, [report, toast])

  const finishImport = useCallback(async (draft: ImportDraft, nameInput: string): Promise<Outcome & { slug?: string }> => {
    const name = nameInput.trim()
    const slug = slugifyWorkspace(name)
    if (!slug) return { ok: false, reason: 'Give it a name with at least one letter or number.' }
    const exists = listRef.current.some(entry => entry.slug === slug)
    try {
      if (draft.kind === 'board') {
        if (exists) return { ok: false, reason: `There's already a workspace called "${slug}". Choose another name.` }
        // listed first, so a partial failure still keeps what arrived
        await persist([...listRef.current, { slug, name, color: nextColor(listRef.current) }])
        const summary = await applyImportedBoard(slug, draft.board)
        toast(summary, { duration: 8000 })
        return { ok: true, slug }
      }
      const res = await importContextData(slug, draft.payload)
      if (!res.success) return { ok: false, reason: `Couldn't import it: ${res.error}` }
      if (!exists) await persist([...listRef.current, { slug, name, color: nextColor(listRef.current) }])
      toast(`Imported ${name}`, { type: 'success' })
      return { ok: true, slug }
    } catch (err) {
      return { ok: false, reason: `Couldn't import it: ${errorMessage(err)}` }
    }
  }, [persist, toast])

  return { list, loading, create, update, remove, unshare, move, moveTo, exportOne, startImport, finishImport }
}

export type Workspaces = ReturnType<typeof useWorkspaces>
