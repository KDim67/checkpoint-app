import React, { useState, useEffect, useCallback } from 'react'
import type { ContextExport } from '../../../../shared/types'
import { Plus, Trash2, Edit2, ChevronUp, ChevronDown, AlertTriangle, Download, Upload } from 'lucide-react'
import { Divider, RowBetween } from './SettingsSection'
import { useAppStore } from '../../store/appStore'
import ColorPicker from '../ui/ColorPicker'
import { useToast } from '../ui/Toast'
import ModalShell from '../ui/ModalShell'
import {
  applyImportedBoard,
  createWorkspace,
  setWorkspaceShared,
  slugifyWorkspace,
  type WorkspaceEntry
} from '../../lib/createWorkspace'
import SharedBadge from '../ui/SharedBadge'
import type { ImportedBoard } from '../../../../shared/foreignImport'
import { errorMessage } from '../../../../shared/errors'
import {
  PROJECT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  describeTemplate
} from '../../../../shared/projectTemplates'
import { readWorkspaceList, writeWorkspaceList } from '../../lib/workspaceList'
import { countItems } from '../../data/items'
import { exportContext, importContext, importContextData, renameContext } from '../../data/workspaces'


const PRESET_COLORS = [
  '#1e45fc', '#cdf12b', '#10b981', '#f97316',
  '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'
]


export default function WorkspaceManager() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setWorkspace = useAppStore(s => s.setWorkspace)
  const availableWorkspaces = useAppStore(s => s.availableWorkspaces)
  const setAvailableWorkspaces = useAppStore(s => s.setAvailableWorkspaces)
  const setWorkspaceList = useAppStore(s => s.setWorkspaceList)

  const { toast } = useToast()

  const [contexts, setContexts] = useState<WorkspaceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSlugVal, setEditSlugVal] = useState('')
  const [editGitPath, setEditGitPath] = useState('')
  const [editColor, setEditColor] = useState(PRESET_COLORS[0])
  const [deleteWarning, setDeleteWarning] = useState<{ slug: string; count: number } | null>(null)
  const [addName, setAddName] = useState('')
  const [addGitPath, setAddGitPath] = useState('')
  const [addColor, setAddColor] = useState(PRESET_COLORS[0])
  const [showAddForm, setShowAddForm] = useState(false)
  const [addTemplateId, setAddTemplateId] = useState(DEFAULT_TEMPLATE_ID)
  const [creating, setCreating] = useState(false)

  const [importPayload, setImportPayload] = useState<ContextExport | null>(null)
  /** set instead of importPayload for another app's file */
  const [importBoard, setImportBoard] = useState<ImportedBoard | null>(null)
  const [importing, setImporting] = useState(false)
  const [importName, setImportName] = useState('')
  const [importSlug, setImportSlug] = useState('')

  const handleExport = async (slug: string, name: string) => {
    try {
      const res = await exportContext(slug, name)
      if (res.success && res.filePath) {
        toast(`Exported workspace successfully to ${res.filePath.split(/[\\/]/).pop()}`)
      } else if (res.error) {
        toast(`Export failed: ${res.error}`)
      }
    } catch (err) {
      toast(`Export failed: ${errorMessage(err)}`)
    }
  }

  const handleImportStart = async () => {
    try {
      const res = await importContext()
      if (res.success && res.payload) {
        setImportBoard(null)
        setImportPayload(res.payload)
        const initialName = res.payload.context
        const baseName = initialName.charAt(0).toUpperCase() + initialName.slice(1)
        setImportName(baseName)
        setImportSlug(slugifyWorkspace(baseName))
      } else if (res.success && res.foreign) {
        // its own name is the default, editable before anything's written
        setImportPayload(null)
        setImportBoard(res.foreign)
        setImportName(res.foreign.name)
        setImportSlug(slugifyWorkspace(res.foreign.name))
      } else if (res.error) {
        toast(`Import failed: ${res.error}`)
      }
    } catch (err) {
      toast(`Import failed: ${errorMessage(err)}`)
    }
  }

  /** written through the ordinary paths */
  const handleForeignImportConfirm = async () => {
    if (!importBoard || !importName.trim() || importing) return
    const slug = slugifyWorkspace(importName)
    if (!slug) { toast('That name has no letters or numbers in it.'); return }
    if (contexts.some(c => c.slug === slug)) {
      toast(`A workspace called "${slug}" already exists. Choose another name.`)
      return
    }

    setImporting(true)
    try {
      const newEntry: WorkspaceEntry = {
        slug,
        name: importName.trim(),
        color: PRESET_COLORS[contexts.length % PRESET_COLORS.length]
      }
      // registered first, so a partial failure still keeps what arrived
      await persist([...contexts, newEntry])
      const summary = await applyImportedBoard(slug, importBoard)
      setWorkspace(slug)
      setImportBoard(null)
      toast(summary, { duration: 8000 })
    } catch (err) {
      toast(`Import failed: ${errorMessage(err)}`)
    } finally {
      setImporting(false)
    }
  }

  const handleImportConfirm = async () => {
    if (!importPayload || !importName.trim()) return
    const slug = slugifyWorkspace(importName)
    if (!slug) return

    try {
      const exists = contexts.some(c => c.slug === slug)
      
      const res = await importContextData(slug, importPayload)
      if (res.success) {
        if (!exists) {
          const newEntry: WorkspaceEntry = {
            slug,
            name: importName.trim(),
            color: PRESET_COLORS[contexts.length % PRESET_COLORS.length]
          }
          await persist([...contexts, newEntry])
        }
        setWorkspace(slug)
        toast(`Imported workspace "${importName}" successfully!`)
        setImportPayload(null)
      } else {
        toast(`Import failed: ${res.error}`)
      }
    } catch (err) {
      toast(`Import failed: ${errorMessage(err)}`)
    }
  }

  const load = useCallback(async () => {
    try {
      const stored = await readWorkspaceList()
      if (stored.length > 0) {
        setContexts(stored)
      } else {
        const bootstrapped: WorkspaceEntry[] = availableWorkspaces.map((slug, i) => ({
          slug,
          name: slug.charAt(0).toUpperCase() + slug.slice(1),
          color: PRESET_COLORS[i % PRESET_COLORS.length]
        }))
        await writeWorkspaceList(bootstrapped)
        setContexts(bootstrapped)
      }
    } catch (err) {
      console.error('Failed to load contexts:', err)
    } finally {
      setLoading(false)
    }
  }, [availableWorkspaces])

  useEffect(() => { load() }, [load])

  const persist = async (updated: WorkspaceEntry[]) => {
    await writeWorkspaceList(updated)
    setContexts(updated)
    setAvailableWorkspaces(updated.map(c => c.slug))
    setWorkspaceList(updated)
  }

  /** only the label, it was never a mode */
  const handleUnshare = async (slug: string) => {
    const updated = setWorkspaceShared(contexts, slug, false)
    if (updated === contexts) return
    try {
      await persist(updated)
    } catch (err) {
      console.error('Failed to clear the shared label:', err)
    }
  }

  const handleAdd = async () => {
    const trimmed = addName.trim()
    if (!trimmed || creating) return
    const slug = slugifyWorkspace(trimmed)
    if (contexts.some(c => c.slug === slug)) return

    const newEntry: WorkspaceEntry = {
      slug,
      name: trimmed,
      color: addColor,
      gitPath: addGitPath.trim() || undefined
    }

    setCreating(true)
    try {
      // shared with the first-run panel
      const { list, summary, templateFailed } = await createWorkspace(contexts, newEntry, addTemplateId)
      setContexts(list)
      setAvailableWorkspaces(list.map(c => c.slug))
      setWorkspaceList(list)

      // the workspace is saved; a lost template is a warning, not an unwind
      if (templateFailed) toast('Workspace created, but the template could not be applied.')

      setWorkspace(slug)
      if (summary) toast(summary)

      setAddName('')
      setAddGitPath('')
      setAddColor(PRESET_COLORS[0])
      setAddTemplateId(DEFAULT_TEMPLATE_ID)
      setShowAddForm(false)
    } finally {
      setCreating(false)
    }
  }

  const handleSaveEdit = async (slug: string) => {
    const trimmed = editName.trim()
    if (!trimmed) { setEditingSlug(null); return }

    const newSlug = slugifyWorkspace(editSlugVal) || slugifyWorkspace(trimmed)
    if (!newSlug) { toast('Invalid workspace slug'); return }

    // a new slug must be unique
    if (newSlug !== slug && contexts.some(c => c.slug === newSlug)) {
      toast(`Workspace slug "${newSlug}" already exists. Please choose a different name or slug.`);
      return
    }

    try {
      if (newSlug !== slug) {
        const res = await renameContext(slug, newSlug)
        if (res && res.error) {
          toast(`Failed to rename workspace: ${res.error}`)
          return
        }
        if (activeWorkspace === slug) {
          setWorkspace(newSlug)
        }
      }

      const updated = contexts.map(c =>
        c.slug === slug ? { ...c, slug: newSlug, name: trimmed, color: editColor, gitPath: editGitPath.trim() || undefined } : c
      )
      await persist(updated)
      setEditingSlug(null)
      toast('Workspace updated successfully!')
    } catch (err) {
      toast(`Failed to save: ${errorMessage(err)}`)
    }
  }

  const handleDeleteRequest = async (slug: string) => {
    try {
      const count = (await countItems(slug, 'task')) + (await countItems(slug, 'card'))
      setDeleteWarning({ slug, count })
    } catch {
      setDeleteWarning({ slug, count: 0 })
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteWarning) return
    const { slug } = deleteWarning
    const updated = contexts.filter(c => c.slug !== slug)
    await persist(updated)
    if (activeWorkspace === slug && updated.length > 0) {
      setWorkspace(updated[0].slug)
    }
    setDeleteWarning(null)
  }

  const handleMoveUp = async (index: number) => {
    if (index === 0) return
    const updated = [...contexts]
    ;[updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]
    await persist(updated)
  }

  const handleMoveDown = async (index: number) => {
    if (index === contexts.length - 1) return
    const updated = [...contexts]
    ;[updated[index], updated[index + 1]] = [updated[index + 1], updated[index]]
    await persist(updated)
  }

  if (loading) return <div className="text-sm-faint">Loading workspaces…</div>

  return (
    <div className="col-md">
      {contexts.map((ctx, i) => (
        <div
          key={ctx.slug}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-3)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-md)',
            border: activeWorkspace === ctx.slug
              ? `1px solid ${ctx.color}50`
              : '1px solid var(--color-surface-offset)'
          }}
        >
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: ctx.color,
            flexShrink: 0
          }} />

          {editingSlug === ctx.slug ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1 }}>
              <div className="row">
                <span className="text-caption-60">Name:</span>
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveEdit(ctx.slug)
                    if (e.key === 'Escape') setEditingSlug(null)
                  }}
                  style={{
                    flex: 1,
                    background: 'var(--color-surface-1)',
                    border: `1px solid ${ctx.color}`,
                    color: 'var(--color-text-base)',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: 'var(--text-sm)',
                    outline: 'none'
                  }}
                />
              </div>
              <div className="row">
                <span className="text-caption-60">Slug (#):</span>
                <input
                  value={editSlugVal}
                  onChange={e => setEditSlugVal(slugifyWorkspace(e.target.value))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveEdit(ctx.slug)
                    if (e.key === 'Escape') setEditingSlug(null)
                  }}
                  style={{
                    flex: 1,
                    background: 'var(--color-surface-1)',
                    border: `1px solid ${ctx.color}50`,
                    color: 'var(--color-text-base)',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: 'var(--text-sm)',
                    outline: 'none'
                  }}
                />
              </div>
              <div className="row">
                <span className="text-caption-60">Git Path:</span>
                <input
                  value={editGitPath}
                  onChange={e => setEditGitPath(e.target.value)}
                  placeholder="e.g. C:/projects/my-repo"
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveEdit(ctx.slug)
                    if (e.key === 'Escape') setEditingSlug(null)
                  }}
                  style={{
                    flex: 1,
                    background: 'var(--color-surface-1)',
                    border: `1px solid ${ctx.color}50`,
                    color: 'var(--color-text-base)',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: 'var(--text-sm)',
                    outline: 'none'
                  }}
                />
              </div>
              <div className="row-wrap">
                <span className="text-caption-60">Color:</span>
                <div className="row-wrap-6px">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setEditColor(c)}
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: c,
                        border: editColor === c ? '2px solid white' : '2px solid transparent',
                        cursor: 'pointer',
                        padding: 0,
                        flexShrink: 0
                      }}
                    />
                  ))}
                  <ColorPicker
                    value={editColor}
                    onCommit={cVal => setEditColor(cVal)}
                    swatchSize={20}
                    hexInputWidth={62}
                    title="Custom Workspace Color"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: '2px' }}>
                <button className="btn-primary" style={{ fontSize: '11px', padding: '2px 8px', height: '22px', display: 'flex', alignItems: 'center' }}
                  onClick={() => handleSaveEdit(ctx.slug)}>
                  Save
                </button>
                <button className="btn-secondary" style={{ fontSize: '11px', padding: '2px 8px', height: '22px', display: 'flex', alignItems: 'center' }}
                  onClick={() => setEditingSlug(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="fill">
                <div className="text-item">
                  {ctx.name}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  flexWrap: 'wrap',
                  marginTop: '2px'
                }}>
                  <span style={{
                    fontSize: '11px',
                    color: 'var(--color-text-faint)',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    #{ctx.slug}
                  </span>
                  {/* clickable so a board no longer shared can drop the badge */}
                  {ctx.shared && (
                    <button
                      onClick={() => handleUnshare(ctx.slug)}
                      title="Shared with someone. Click to clear the label."
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      <SharedBadge withLabel />
                    </button>
                  )}
                  {ctx.gitPath && (
                    <span style={{
                      fontSize: '10px',
                      color: 'var(--color-secondary)',
                      fontFamily: 'var(--font-mono)',
                      background: 'rgba(205, 241, 43, 0.1)',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      maxWidth: '180px'
                    }} title={ctx.gitPath}>
                      git: {ctx.gitPath}
                    </span>
                  )}
                </div>
              </div>

              <div className="row-4px">
                <button
                  className="btn-icon"
                  style={{ width: '24px', height: '24px', opacity: i === 0 ? 0.3 : 1 }}
                  onClick={() => handleMoveUp(i)}
                  title="Move up"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  className="btn-icon"
                  style={{ width: '24px', height: '24px', opacity: i === contexts.length - 1 ? 0.3 : 1 }}
                  onClick={() => handleMoveDown(i)}
                  title="Move down"
                >
                  <ChevronDown size={14} />
                </button>
                 <button
                  className="btn-icon"
                  style={{ width: '24px', height: '24px' }}
                  onClick={() => handleExport(ctx.slug, ctx.name)}
                  title="Export Workspace"
                >
                  <Download size={12} />
                </button>
                <button
                  className="btn-icon"
                  style={{ width: '24px', height: '24px' }}
                  onClick={() => {
                    setEditingSlug(ctx.slug)
                    setEditName(ctx.name)
                    setEditSlugVal(ctx.slug)
                    setEditColor(ctx.color)
                    setEditGitPath(ctx.gitPath || '')
                  }}
                  title="Edit Workspace"
                >
                  <Edit2 size={11} />
                </button>
                {contexts.length > 1 && (
                  <button
                    className="btn-icon"
                    style={{ width: '24px', height: '24px', color: 'var(--color-error)' }}
                    onClick={() => handleDeleteRequest(ctx.slug)}
                    title="Delete workspace"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      <Divider />

      {showAddForm ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-primary)'
        }}>
          <input
            autoFocus
            value={addName}
            onChange={e => setAddName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAddForm(false) }}
            placeholder="Workspace name (e.g. Side Project)"
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-sm)',
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box'
            }}
          />
          <input
            value={addGitPath}
            onChange={e => setAddGitPath(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAddForm(false) }}
            placeholder="Git Repository Path (optional, e.g. C:/projects/my-repo)"
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-sm)',
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box'
            }}
          />
          <div className="row-wrap">
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', flexShrink: 0 }}>Color:</span>
            <div className="row-wrap-6px">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setAddColor(c)}
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: c,
                    border: addColor === c ? '2px solid white' : '2px solid transparent',
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0
                  }}
                />
              ))}
              <ColorPicker
                value={addColor}
                onCommit={cVal => setAddColor(cVal)}
                swatchSize={20}
                hexInputWidth={62}
                title="Custom Workspace Color"
              />
            </div>
          </div>
          <div className="col">
            <span className="text-hint">
              Start from
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '210px', overflowY: 'auto' }}>
              {PROJECT_TEMPLATES.map(t => {
                const selected = addTemplateId === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setAddTemplateId(t.id)}
                    aria-pressed={selected}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '2px',
                      textAlign: 'left',
                      background: selected ? 'var(--color-surface-offset)' : 'var(--color-surface-1)',
                      border: selected
                        ? `1px solid ${addColor}`
                        : '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-2) var(--space-3)',
                      cursor: 'pointer',
                      width: '100%'
                    }}
                  >
                    <span className="text-item">
                      {t.name}
                    </span>
                    <span className="text-caption">
                      {t.description}
                    </span>
                    <span className="text-mono-micro">
                      {describeTemplate(t)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {addName.trim() && (
            <div className="text-caption-faint">
              Slug: <code className="mono">#{slugifyWorkspace(addName)}</code>
            </div>
          )}
          <div className="flex-gap">
            <button
              className="btn-primary"
              style={{
                fontSize: 'var(--text-xs)',
                padding: 'var(--space-1-5) var(--space-4)',
                opacity: creating || !addName.trim() ? 0.5 : 1
              }}
              disabled={creating || !addName.trim()}
              onClick={handleAdd}
            >
              {creating ? 'Creating…' : 'Add Workspace'}
            </button>
            <button className="btn-secondary" style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-1-5) var(--space-4)' }}
              disabled={creating}
              onClick={() => { setShowAddForm(false); setAddName(''); setAddGitPath(''); setAddTemplateId(DEFAULT_TEMPLATE_ID) }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="col">
          <button
            className="btn-ghost"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              border: '1px dashed var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              width: '100%',
              justifyContent: 'center'
            }}
            onClick={() => setShowAddForm(true)}
          >
            <Plus size={14} />
            Add Workspace
          </button>
          
          <button
            className="btn-ghost"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              border: '1px dashed var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              width: '100%',
              justifyContent: 'center'
            }}
            onClick={handleImportStart}
          >
            <Upload size={14} />
            Import a workspace, Trello board or Todoist project
          </button>
        </div>
      )}

      {deleteWarning && (
        <ModalShell label="Delete workspace" onClose={() => setDeleteWarning(null)} width="380px" closeOnBackdrop={false}>
          <div className="row-md">
            <AlertTriangle size={20} color="var(--color-warning)" />
            <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)' }}>
              Delete workspace?
            </span>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            This will hide all{' '}
            <strong className="text-base">
              {deleteWarning.count} item{deleteWarning.count !== 1 ? 's' : ''}
            </strong>{' '}
            in <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-secondary)' }}>
              #{deleteWarning.slug}
            </code>. Items are <em>not</em> deleted from the database and can be recovered.
          </p>
          <RowBetween>
            <button className="btn-secondary" style={{ fontSize: 'var(--text-sm)' }}
              onClick={() => setDeleteWarning(null)}>
              Cancel
            </button>
            <button
              onClick={handleDeleteConfirm}
              style={{
                background: 'var(--color-error)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-4)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-semibold)'
              }}
            >
              Delete Workspace
            </button>
          </RowBetween>
        </ModalShell>
      )}

      {(importPayload || importBoard) && (
        <ModalShell label="Import workspace" onClose={() => { setImportPayload(null); setImportBoard(null) }} closeOnBackdrop={false}>
          <div className="row-md">
            <Plus size={20} color="var(--color-secondary)" />
            <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)' }}>
              Import Workspace
            </span>
          </div>
          
          <div className="col-md">
            <div className="col-xs">
              <label htmlFor="import-context-name" className="text-hint-strong">
                Workspace Name
              </label>
              <input
                id="import-context-name"
                autoFocus
                value={importName}
                onChange={e => {
                  setImportName(e.target.value)
                  setImportSlug(slugifyWorkspace(e.target.value))
                }}
                placeholder="e.g. My Imported Project"
                style={{
                  background: 'var(--color-surface-3)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  fontSize: 'var(--text-xs)',
                  padding: '8px var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  outline: 'none'
                }}
              />
            </div>

            <div className="text-caption-faint">
              Slug: <code className="mono">#{importSlug}</code>
            </div>

            {contexts.some(c => c.slug === importSlug) && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '8px', borderRadius: '4px', fontSize: '11px', color: 'var(--color-error)' }}>
                <AlertTriangle size={14} />
                <span>Warning: Workspace #{importSlug} already exists. This will merge/overwrite items!</span>
              </div>
            )}

            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
              {importBoard ? (
                <>
                  From <strong>{importBoard.source === 'todoist' ? 'Todoist' : 'Trello'}</strong>: <strong>{importBoard.columns.length}</strong> columns
                  and <strong>{importBoard.cards.length}</strong> cards.
                  {importBoard.notes.length > 0 && (
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {importBoard.notes.map(note => (
                        <span key={note} className="text-faint">· {note}</span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>Contains: <strong>{importPayload?.items?.length || 0}</strong> items, <strong>{importPayload?.tags?.length || 0}</strong> tags, and <strong>{importPayload?.relations?.length || 0}</strong> relations.</>
              )}
            </div>
          </div>

          <div className="mt-2">
            <RowBetween>
              <button className="btn-secondary" style={{ fontSize: 'var(--text-sm)' }}
                onClick={() => { setImportPayload(null); setImportBoard(null) }}>
                Cancel
              </button>
              <button
                onClick={importBoard ? handleForeignImportConfirm : handleImportConfirm}
                disabled={!importName.trim() || !importSlug || importing}
                className="btn-primary"
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  opacity: (!importName.trim() || !importSlug) ? 0.5 : 1
                }}
              >
                {importing ? 'Importing…' : 'Import Workspace'}
              </button>
            </RowBetween>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
