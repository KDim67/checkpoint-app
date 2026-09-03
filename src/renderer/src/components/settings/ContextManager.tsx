import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Edit2, ChevronUp, ChevronDown, AlertTriangle, Download, Upload } from 'lucide-react'
import { Divider, RowBetween } from './SettingsSection'
import { useAppStore } from '../../store/appStore'
import ColorPicker from '../ui/ColorPicker'
import { useToast } from '../ui/Toast'
import ModalShell from '../ui/ModalShell'
import { createWorkspace, slugifyWorkspace, type WorkspaceEntry } from '../../lib/createWorkspace'
import {
  PROJECT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  describeTemplate
} from '../../../../shared/projectTemplates'

type ContextEntry = WorkspaceEntry

const PRESET_COLORS = [
  '#1e45fc', '#cdf12b', '#10b981', '#f97316',
  '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'
]

const STORAGE_KEY = 'contexts_list'

export default function ContextManager() {
  const activeContext = useAppStore(s => s.activeContext)
  const setContext = useAppStore(s => s.setContext)
  const availableContexts = useAppStore(s => s.availableContexts)
  const setAvailableContexts = useAppStore(s => s.setAvailableContexts)
  const setContextsList = useAppStore(s => s.setContextsList)

  const { toast } = useToast()

  const [contexts, setContexts] = useState<ContextEntry[]>([])
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

  // State for Import Modal
  const [importPayload, setImportPayload] = useState<any | null>(null)
  const [importName, setImportName] = useState('')
  const [importSlug, setImportSlug] = useState('')

  const handleExport = async (slug: string, name: string) => {
    try {
      const res = await window.electronAPI.db.exportContext(slug, name)
      if (res.success && res.filePath) {
        toast(`Exported context successfully to ${res.filePath.split(/[\\/]/).pop()}`)
      } else if (res.error) {
        toast(`Export failed: ${res.error}`)
      }
    } catch (err: any) {
      toast(`Export failed: ${err.message || String(err)}`)
    }
  }

  const handleImportStart = async () => {
    try {
      const res = await window.electronAPI.db.importContext()
      if (res.success && res.payload) {
        setImportPayload(res.payload)
        const initialName = res.payload.context
        const baseName = initialName.charAt(0).toUpperCase() + initialName.slice(1)
        setImportName(baseName)
        setImportSlug(slugifyWorkspace(baseName))
      } else if (res.error) {
        toast(`Import failed: ${res.error}`)
      }
    } catch (err: any) {
      toast(`Import failed: ${err.message || String(err)}`)
    }
  }

  const handleImportConfirm = async () => {
    if (!importPayload || !importName.trim()) return
    const slug = slugifyWorkspace(importName)
    if (!slug) return

    try {
      const exists = contexts.some(c => c.slug === slug)
      
      const res = await window.electronAPI.db.importContextData(slug, importPayload)
      if (res.success) {
        if (!exists) {
          const newEntry: ContextEntry = {
            slug,
            name: importName.trim(),
            color: PRESET_COLORS[contexts.length % PRESET_COLORS.length]
          }
          await persist([...contexts, newEntry])
        }
        setContext(slug)
        toast(`Imported context "${importName}" successfully!`)
        setImportPayload(null)
      } else {
        toast(`Import failed: ${res.error}`)
      }
    } catch (err: any) {
      toast(`Import failed: ${err.message || String(err)}`)
    }
  }

  const load = useCallback(async () => {
    try {
      const raw = await window.electronAPI.db.getSetting(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw as string) as ContextEntry[]
        setContexts(parsed)
      } else {
        // Bootstrap from availableContexts
        const bootstrapped: ContextEntry[] = availableContexts.map((slug, i) => ({
          slug,
          name: slug.charAt(0).toUpperCase() + slug.slice(1),
          color: PRESET_COLORS[i % PRESET_COLORS.length]
        }))
        await window.electronAPI.db.setSetting(STORAGE_KEY, JSON.stringify(bootstrapped))
        setContexts(bootstrapped)
      }
    } catch (err) {
      console.error('Failed to load contexts:', err)
    } finally {
      setLoading(false)
    }
  }, [availableContexts])

  useEffect(() => { load() }, [load])

  const persist = async (updated: ContextEntry[]) => {
    await window.electronAPI.db.setSetting(STORAGE_KEY, JSON.stringify(updated))
    setContexts(updated)
    setAvailableContexts(updated.map(c => c.slug))
    setContextsList(updated)
  }

  const handleAdd = async () => {
    const trimmed = addName.trim()
    if (!trimmed || creating) return
    const slug = slugifyWorkspace(trimmed)
    if (contexts.some(c => c.slug === slug)) return

    const newEntry: ContextEntry = {
      slug,
      name: trimmed,
      color: addColor,
      gitPath: addGitPath.trim() || undefined
    }

    setCreating(true)
    try {
      // Shared with the first-run panel, so both produce the same workspace.
      const { list, summary, templateFailed } = await createWorkspace(contexts, newEntry, addTemplateId)
      setContexts(list)
      setAvailableContexts(list.map(c => c.slug))
      setContextsList(list)

      // The workspace itself is already saved; losing the scaffolding is worth
      // a warning, not an unwind that would leave nothing behind.
      if (templateFailed) toast('Workspace created, but the template could not be applied.')

      setContext(slug)
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

    // If slug changed, ensure it's unique
    if (newSlug !== slug && contexts.some(c => c.slug === newSlug)) {
      toast(`Workspace slug "${newSlug}" already exists. Please choose a different name or slug.`);
      return
    }

    try {
      if (newSlug !== slug) {
        // Run DB update/migration
        const res = await window.electronAPI.db.renameContext(slug, newSlug)
        if (res && res.error) {
          toast(`Failed to rename workspace: ${res.error}`)
          return
        }
        // Update active context if it was active
        if (activeContext === slug) {
          setContext(newSlug)
        }
      }

      const updated = contexts.map(c =>
        c.slug === slug ? { ...c, slug: newSlug, name: trimmed, color: editColor, gitPath: editGitPath.trim() || undefined } : c
      )
      await persist(updated)
      setEditingSlug(null)
      toast('Workspace updated successfully!')
    } catch (err: any) {
      toast(`Failed to save: ${err.message || String(err)}`)
    }
  }

  const handleDeleteRequest = async (slug: string) => {
    try {
      const res = await window.electronAPI.db.getItems(slug, 'task', 1, 1)
      const cardRes = await window.electronAPI.db.getItems(slug, 'card', 1, 1)
      const count = (res.total ?? 0) + (cardRes.total ?? 0)
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
    if (activeContext === slug && updated.length > 0) {
      setContext(updated[0].slug)
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

  if (loading) return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>Loading contexts…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Context list */}
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
            border: activeContext === ctx.slug
              ? `1px solid ${ctx.color}50`
              : '1px solid var(--color-surface-offset)'
          }}
        >
          {/* Color dot */}
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: ctx.color,
            flexShrink: 0
          }} />

          {/* Name or edit input */}
          {editingSlug === ctx.slug ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1 }}>
              <div className="row">
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', width: '60px' }}>Name:</span>
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
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', width: '60px' }}>Slug (#):</span>
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
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', width: '60px' }}>Git Path:</span>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', width: '60px' }}>Color:</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
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
                    title="Custom Context Color"
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-medium)',
                  color: 'var(--color-text-base)'
                }}>
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

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {/* Reorder */}
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
                  title="Export Context Workspace"
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
                  title="Edit Context"
                >
                  <Edit2 size={11} />
                </button>
                {contexts.length > 1 && (
                  <button
                    className="btn-icon"
                    style={{ width: '24px', height: '24px', color: 'var(--color-error)' }}
                    onClick={() => handleDeleteRequest(ctx.slug)}
                    title="Delete context"
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

      {/* Add form */}
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
            placeholder="Context name (e.g. Side Project)"
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
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', flexShrink: 0 }}>Color:</span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
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
                title="Custom Context Color"
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
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
                    <span style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--weight-medium)',
                      color: 'var(--color-text-base)'
                    }}>
                      {t.name}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      {t.description}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}>
                      {describeTemplate(t)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {addName.trim() && (
            <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
              Slug: <code style={{ fontFamily: 'var(--font-mono)' }}>#{slugifyWorkspace(addName)}</code>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
              {creating ? 'Creating…' : 'Add Context'}
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
            Add Context
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
            Import Context / Workspace
          </button>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteWarning && (
        <ModalShell label="Delete context" onClose={() => setDeleteWarning(null)} width="380px" closeOnBackdrop={false}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <AlertTriangle size={20} color="var(--color-warning)" />
            <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)' }}>
              Delete context?
            </span>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            This will hide all{' '}
            <strong style={{ color: 'var(--color-text-base)' }}>
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
              Delete Context
            </button>
          </RowBetween>
        </ModalShell>
      )}

      {/* Import confirmation modal */}
      {importPayload && (
        <ModalShell label="Import workspace" onClose={() => setImportPayload(null)} closeOnBackdrop={false}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Plus size={20} color="var(--color-secondary)" />
            <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)' }}>
              Import Workspace Context
            </span>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <label htmlFor="import-context-name" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
                Workspace Context Name
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

            <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
              Slug: <code style={{ fontFamily: 'var(--font-mono)' }}>#{importSlug}</code>
            </div>

            {contexts.some(c => c.slug === importSlug) && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '8px', borderRadius: '4px', fontSize: '11px', color: 'var(--color-error)' }}>
                <AlertTriangle size={14} />
                <span>Warning: Context #{importSlug} already exists. This will merge/overwrite items!</span>
              </div>
            )}

            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
              Contains: <strong>{importPayload.items?.length || 0}</strong> items, <strong>{importPayload.tags?.length || 0}</strong> tags, and <strong>{importPayload.relations?.length || 0}</strong> relations.
            </div>
          </div>

          <div style={{ marginTop: 'var(--space-2)' }}>
            <RowBetween>
              <button className="btn-secondary" style={{ fontSize: 'var(--text-sm)' }}
                onClick={() => setImportPayload(null)}>
                Cancel
              </button>
              <button
                onClick={handleImportConfirm}
                disabled={!importName.trim() || !importSlug}
                className="btn-primary"
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  opacity: (!importName.trim() || !importSlug) ? 0.5 : 1
                }}
              >
                Import Workspace
              </button>
            </RowBetween>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
