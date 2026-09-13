import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Save, Trash2, FileText, Eye, Edit3, Columns,
  Download, PanelRightOpen, PanelRightClose, ArrowLeft, ArrowRight, FileWarning, Maximize2, X } from 'lucide-react'
import { useToast } from './ui/Toast'
import GraphView from './notes/GraphView'
import NotesSidebar, { type SidebarItem } from './notes/NotesSidebar'
import NoteEditor from './notes/NoteEditor'
import MarkdownPreview from './notes/MarkdownPreview'
import {
  prefs, formatRelativeTime, formatBytes, countWords,
  NOTE_TEMPLATES, isoDate, dailyNoteContent,
  type SortKey, type ViewMode
} from './notes/notesUtils'
import type { NoteMetadata, NoteSearchResult } from '../../../shared/types'
import { useAppStore } from '../store/appStore'
import * as notesApi from '../data/notes'
import * as appApi from '../data/app'

export default function NotesView(): React.JSX.Element {
  const { toast } = useToast()

  const [notes, setNotes] = useState<NoteMetadata[]>([])
  const [activeNoteTitle, setActiveNoteTitle] = useState<string | null>(null)
  const [activeNoteContent, setActiveNoteContent] = useState<string>('')
  const [tempTitle, setTempTitle] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchResults, setSearchResults] = useState<NoteSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [mode, setMode] = useState<ViewMode>(prefs.getMode())
  const [showInfo, setShowInfo] = useState<boolean>(prefs.getShowInfo())
  const [isDirty, setIsDirty] = useState<boolean>(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [pendingDeleteTitle, setPendingDeleteTitle] = useState<string | null>(null)
  const [pins, setPins] = useState<string[]>(prefs.getPins())
  // the graph was only a 220px thumbnail, too small to trace a link
  const [graphExpanded, setGraphExpanded] = useState(false)
  const [sort, setSort] = useState<SortKey>(prefs.getSort())

  const renamingRef = useRef(false)

  const pinnedSet = useMemo(() => new Set(pins), [pins])
  const noteTitles = useMemo(() => notes.map(n => n.title), [notes])
  const titleLookup = useMemo(() => new Set(notes.map(n => n.title.toLowerCase())), [notes])

  useEffect(() => { prefs.setMode(mode) }, [mode])
  useEffect(() => { prefs.setShowInfo(showInfo) }, [showInfo])
  useEffect(() => { prefs.setSort(sort) }, [sort])
  useEffect(() => { prefs.setPins(pins) }, [pins])
  useEffect(() => { prefs.setLastNote(activeNoteTitle) }, [activeNoteTitle])

  const loadNotesList = useCallback(async (): Promise<NoteMetadata[]> => {
    try {
      const list = await notesApi.listNotes()
      setNotes(list)
      return list
    } catch (err) {
      console.error('Failed to list notes:', err)
      toast('Failed to load notes', { type: 'error' })
      return []
    }
  }, [toast])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const list = await loadNotesList()
      // skip when the palette asked for a note, this lands after an IPC round trip and would overwrite it
      const last = prefs.getLastNote()
      if (!useAppStore.getState().pendingNoteTitle && last && list.some(n => n.title === last)) {
        setActiveNoteTitle(last)
      }
      setLoading(false)
    })()
  }, [loadNotesList])

  useEffect(() => {
    if (!activeNoteTitle) {
      setActiveNoteContent('')
      setTempTitle('')
      setIsDirty(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const content = await notesApi.readNote(activeNoteTitle)
        if (cancelled) return
        setActiveNoteContent(content)
        setTempTitle(activeNoteTitle)
        setIsDirty(false)
      } catch (err) {
        console.error('Failed to read note content:', err)
        toast('Failed to read note', { type: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [activeNoteTitle, toast])

  const saveContent = useCallback(async () => {
    if (!activeNoteTitle) return
    setSaving(true)
    try {
      await notesApi.writeNote(activeNoteTitle, activeNoteContent, activeNoteTitle)
      setIsDirty(false)
      await loadNotesList()
    } catch (err) {
      console.error('Failed to save note:', err)
      toast('Failed to save note', { type: 'error' })
    } finally {
      setSaving(false)
    }
  }, [activeNoteTitle, activeNoteContent, loadNotesList, toast])

  useEffect(() => {
    if (!activeNoteTitle || !isDirty) return
    const timer = setTimeout(() => { saveContent() }, 1200)
    return () => clearTimeout(timer)
  }, [activeNoteContent, isDirty, activeNoteTitle, saveContent])

  // collision-safe, explicit commit
  const commitRename = useCallback(async (desired: string): Promise<boolean> => {
    if (!activeNoteTitle || renamingRef.current) return false
    const next = desired.trim()
    if (!next || next === activeNoteTitle) return false
    if (titleLookup.has(next.toLowerCase())) {
      toast(`A note titled “${next}” already exists`, { type: 'error' })
      setTempTitle(activeNoteTitle)
      return false
    }
    renamingRef.current = true
    try {
      await notesApi.writeNote(next, activeNoteContent, activeNoteTitle)
      // move pin and selection to the new title
      setPins(p => p.map(t => (t === activeNoteTitle ? next : t)))
      setIsDirty(false)
      setActiveNoteTitle(next)
      await loadNotesList()
      return true
    } catch (err) {
      console.error('Failed to rename note:', err)
      const msg = err instanceof Error ? err.message : 'Failed to rename note'
      toast(msg, { type: 'error' })
      setTempTitle(activeNoteTitle)
      return false
    } finally {
      renamingRef.current = false
    }
  }, [activeNoteTitle, activeNoteContent, titleLookup, loadNotesList, toast])

  // serialised so a title blur and a sidebar click can't both rename and duplicate the file
  const flushRef = useRef<Promise<void> | null>(null)
  const flushPending = useCallback((): Promise<void> => {
    if (flushRef.current) return flushRef.current
    if (!activeNoteTitle) return Promise.resolve()
    const run = (async () => {
      const desired = tempTitle.trim()
      if (desired && desired !== activeNoteTitle) {
        const renamed = await commitRename(desired)
        if (renamed) return
      }
      if (isDirty) await saveContent()
    })().finally(() => { flushRef.current = null })
    flushRef.current = run
    return run
  }, [activeNoteTitle, tempTitle, isDirty, commitRename, saveContent])

  const handleSelectNote = useCallback(async (title: string | null) => {
    if (title === activeNoteTitle) return
    await flushPending()
    setActiveNoteTitle(title)
  }, [activeNoteTitle, flushPending])

  // parked in the store since this view isn't mounted when the palette acts; cleared on arrival
  const pendingNoteTitle = useAppStore(s => s.pendingNoteTitle)
  useEffect(() => {
    if (!pendingNoteTitle) return
    useAppStore.getState().setPendingNoteTitle(null)
    handleSelectNote(pendingNoteTitle)
  }, [pendingNoteTitle, handleSelectNote])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (activeNoteTitle && isDirty) {
          saveContent()
          toast('Note saved', { type: 'success' })
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveContent, activeNoteTitle, isDirty, toast])

  const createNote = useCallback(async (title: string, content: string, activate = true) => {
    try {
      await notesApi.writeNote(title, content)
      const list = await loadNotesList()
      if (activate && list.some(n => n.title === title)) {
        setActiveNoteTitle(title)
        setMode(m => (m === 'preview' ? 'split' : m))
      }
    } catch (err) {
      console.error('Failed to create note:', err)
      toast('Failed to create note', { type: 'error' })
    }
  }, [loadNotesList, toast])

  const uniqueTitle = useCallback((base: string): string => {
    const existing = new Set(notes.map(n => n.title.toLowerCase()))
    if (!existing.has(base.toLowerCase())) return base
    let i = 1
    while (existing.has(`${base} ${i}`.toLowerCase())) i++
    return `${base} ${i}`
  }, [notes])

  const handleCreate = useCallback(async (templateId?: string) => {
    await flushPending()
    const template = NOTE_TEMPLATES.find(t => t.id === templateId)
    const title = uniqueTitle(template && template.id !== 'blank' ? template.label : 'Untitled Note')
    const content = template ? template.build(title) : `# ${title}\n\nStart writing…\n`
    await createNote(title, content)
    toast('Note created', { type: 'success' })
  }, [flushPending, uniqueTitle, createNote, toast])

  /** a vault is already markdown, so copy as is and report what didn't come across */
  const handleImportVault = useCallback(async () => {
    const res = await notesApi.importVault()
    if (res.cancelled) return
    if (!res.success || !res.result) {
      toast(res.error || 'Could not read that vault', { type: 'error' })
      return
    }

    const { notesImported, attachmentsCopied, notes: caveats } = res.result
    await loadNotesList()

    const attachments = attachmentsCopied > 0
      ? ` and ${attachmentsCopied} attachment${attachmentsCopied === 1 ? '' : 's'}`
      : ''
    toast(`Imported ${notesImported} note${notesImported === 1 ? '' : 's'}${attachments} from ${res.vault}`, { type: 'success' })
    // one toast per caveat, only when there's something to say
    for (const caveat of caveats) toast(caveat, { type: 'info' })
  }, [loadNotesList, toast])

  const handleDailyNote = useCallback(async () => {
    await flushPending()
    const title = isoDate()
    if (notes.some(n => n.title === title)) {
      setActiveNoteTitle(title)
      return
    }
    await createNote(title, dailyNoteContent(title))
    toast(`Opened daily note for ${title}`, { type: 'success' })
  }, [flushPending, notes, createNote, toast])

  const handleOpenWikiLink = useCallback((title: string) => {
    const match = notes.find(n => n.title.toLowerCase() === title.toLowerCase())
    if (match) {
      handleSelectNote(match.title)
    } else {
      ;(async () => {
        await flushPending()
        await createNote(title, `# ${title}\n\nCreated from a wiki link.\n`)
        toast(`Created note “${title}”`, { type: 'success' })
      })()
    }
  }, [notes, handleSelectNote, flushPending, createNote, toast])

  const confirmDeleteNote = useCallback(async () => {
    if (!pendingDeleteTitle) return
    const title = pendingDeleteTitle
    setPendingDeleteTitle(null)
    try {
      await notesApi.deleteNote(title)
      setPins(p => p.filter(t => t !== title))
      toast('Note deleted', { type: 'success' })
      if (activeNoteTitle === title) setActiveNoteTitle(null)
      await loadNotesList()
    } catch (err) {
      console.error('Failed to delete note:', err)
      toast('Failed to delete note', { type: 'error' })
    }
  }, [pendingDeleteTitle, activeNoteTitle, loadNotesList, toast])

  const handleExport = useCallback(async () => {
    if (!activeNoteTitle) return
    try {
      const ok = await appApi.saveFile(`${activeNoteTitle}.md`, activeNoteContent)
      if (ok) toast('Note exported', { type: 'success' })
    } catch (err) {
      console.error('Failed to export note:', err)
      toast('Failed to export note', { type: 'error' })
    }
  }, [activeNoteTitle, activeNoteContent, toast])

  const togglePin = useCallback((title: string) => {
    setPins(p => (p.includes(title) ? p.filter(t => t !== title) : [...p, title]))
  }, [])

  // debounced full-text via main
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const results = await notesApi.searchNotes(q)
        setSearchResults(results)
      } catch (err) {
        console.error('Note search failed:', err)
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 220)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const uniqueTags = useMemo(() => {
    const set = new Set<string>()
    notes.forEach(n => n.tags.forEach(t => set.add(t)))
    return Array.from(set).sort()
  }, [notes])

  const displayItems = useMemo<SidebarItem[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    const byTitle = new Map(notes.map(n => [n.title, n]))

    if (q) {
      const items: SidebarItem[] = []
      const added = new Set<string>()
      // backend matches first, ranked
      if (searchResults) {
        for (const r of searchResults) {
          const note = byTitle.get(r.title)
          if (note) { items.push({ note, snippet: r.snippet }); added.add(r.title) }
        }
      }
      // then tag matches the text search misses
      for (const note of notes) {
        if (added.has(note.title)) continue
        if (note.tags.some(t => t.toLowerCase().includes(q))) {
          items.push({ note }); added.add(note.title)
        }
      }
      return items
    }

    // no search: tag filter, sort, pinned first
    let list = notes.filter(n => (selectedTag ? n.tags.includes(selectedTag) : true))
    list = [...list].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'size') return b.size - a.size
      return b.updatedAt - a.updatedAt
    })
    const pinnedItems = list.filter(n => pinnedSet.has(n.title))
    const rest = list.filter(n => !pinnedSet.has(n.title))
    return [...pinnedItems, ...rest].map(note => ({ note }))
  }, [notes, searchQuery, searchResults, selectedTag, sort, pinnedSet])

  const currentNoteMetadata = useMemo(
    () => (activeNoteTitle ? notes.find(n => n.title === activeNoteTitle) ?? null : null),
    [notes, activeNoteTitle]
  )

  const backlinks = useMemo(() => {
    if (!activeNoteTitle) return []
    const lower = activeNoteTitle.toLowerCase()
    return notes
      .filter(n => n.title !== activeNoteTitle && n.links.some(l => l.toLowerCase() === lower))
      .map(n => n.title)
  }, [notes, activeNoteTitle])

  const liveWordCount = useMemo(() => countWords(activeNoteContent), [activeNoteContent])
  const noteExists = useCallback((title: string) => titleLookup.has(title.toLowerCase()), [titleLookup])

  const saveLabel = saving ? 'Saving…' : isDirty ? 'Unsaved' : 'Saved'

  return (
    <div className={`notes-layout-grid ${showInfo ? '' : 'no-info'}`}>
      <style>{NOTES_CSS}</style>

      {/* position:fixed, so its place in the tree doesn't matter */}
      {graphExpanded && (
        <div
          onMouseDown={e => { if (e.target === e.currentTarget) setGraphExpanded(false) }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9998,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-6)'
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Note graph"
            style={{
              width: '100%',
              height: '100%',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-2xl)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div className="row-between" style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-surface-offset)' }}>
              <span className="text-item-strong">
                Note graph
                <span style={{ marginLeft: 'var(--space-2)', fontSize: '11px', color: 'var(--color-text-faint)', fontWeight: 'var(--weight-regular)' }}>
                  {notes.length} note{notes.length === 1 ? '' : 's'} · click one to open it
                </span>
              </span>
              <button className="btn-secondary" onClick={() => setGraphExpanded(false)} aria-label="Close the graph">
                <X size={13} />
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
              {/* same component, sizes to its container */}
              <GraphView
                notes={notes}
                activeTitle={activeNoteTitle}
                onSelectNote={title => { handleSelectNote(title); setGraphExpanded(false) }}
              />
            </div>
          </div>
        </div>
      )}

      <NotesSidebar
        items={displayItems}
        allTags={uniqueTags}
        totalCount={notes.length}
        activeTitle={activeNoteTitle}
        pinned={pinnedSet}
        loading={loading}
        searching={searching}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sort={sort}
        onSortChange={setSort}
        selectedTag={selectedTag}
        onSelectTag={setSelectedTag}
        onSelect={handleSelectNote}
        onTogglePin={togglePin}
        onCreate={handleCreate}
        onDaily={handleDailyNote}
        onImportVault={handleImportVault}
      />

      <div className="notes-editor-panel">
        {activeNoteTitle ? (
          <>
            <div className="notes-editor-header">
              <input
                type="text"
                className="notes-title-input"
                value={tempTitle}
                onChange={e => setTempTitle(e.target.value)}
                onBlur={() => { flushPending() }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                  if (e.key === 'Escape') { setTempTitle(activeNoteTitle); e.currentTarget.blur() }
                }}
                aria-label="Note title"
                spellCheck={false}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 }}>
                <span className="notes-save-status" data-dirty={isDirty}>{saveLabel}</span>

                <div style={{ display: 'flex', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  <button className={`segment-btn ${mode === 'edit' ? 'active' : ''}`} onClick={() => setMode('edit')} title="Edit"><Edit3 size={14} /></button>
                  <button className={`segment-btn ${mode === 'split' ? 'active' : ''}`} onClick={() => setMode('split')} title="Split view"><Columns size={14} /></button>
                  <button className={`segment-btn ${mode === 'preview' ? 'active' : ''}`} onClick={() => setMode('preview')} title="Preview"><Eye size={14} /></button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <button className="notes-icon-btn" onClick={saveContent} disabled={!isDirty} title="Save (Ctrl+S)" aria-label="Save"><Save size={15} /></button>
                  <button className="notes-icon-btn" onClick={handleExport} title="Export as .md" aria-label="Export note"><Download size={15} /></button>
                  <button className="notes-icon-btn" onClick={() => setShowInfo(v => !v)} title={showInfo ? 'Hide info panel' : 'Show info panel'} aria-label="Toggle info panel">
                    {showInfo ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                  </button>

                  {pendingDeleteTitle === activeNoteTitle ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>Delete?</span>
                      <button onClick={confirmDeleteNote} style={{ background: 'var(--color-error)', border: 'none', color: 'var(--color-on-accent)', borderRadius: '4px', padding: '2px 8px', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>Yes</button>
                      <button onClick={() => setPendingDeleteTitle(null)} style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)', borderRadius: '4px', padding: '2px 6px', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>No</button>
                    </span>
                  ) : (
                    <button className="notes-icon-btn notes-icon-btn-danger" onClick={() => setPendingDeleteTitle(activeNoteTitle)} title="Delete note" aria-label="Delete note"><Trash2 size={15} /></button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
              {(mode === 'edit' || mode === 'split') && (
                <NoteEditor
                  content={activeNoteContent}
                  onChange={value => { setActiveNoteContent(value); setIsDirty(true) }}
                  noteTitles={noteTitles}
                />
              )}

              {mode === 'split' && <div style={{ width: '1px', background: 'var(--color-surface-offset)', flexShrink: 0 }} />}

              {(mode === 'preview' || mode === 'split') && (
                <div className="markdown-preview">
                  <MarkdownPreview
                    content={activeNoteContent}
                    onOpenWikiLink={handleOpenWikiLink}
                    noteExists={noteExists}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', color: 'var(--color-text-faint)', padding: 'var(--space-6)', textAlign: 'center' }}>
            <FileText size={48} style={{ opacity: 0.4 }} />
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
              {notes.length === 0 ? 'Your notebook is empty' : 'No note selected'}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', maxWidth: '300px', lineHeight: 1.6 }}>
              Create markdown notes, link them with <code style={{ background: 'var(--color-surface-2)', padding: '1px 4px', borderRadius: '3px' }}>[[Wiki Links]]</code>, organize with <code style={{ background: 'var(--color-surface-2)', padding: '1px 4px', borderRadius: '3px' }}>#tags</code>, and visualize the connections.
            </div>
            <button onClick={() => handleCreate()} style={{ marginTop: 'var(--space-2)', background: 'var(--color-secondary)', border: 'none', color: 'var(--color-text-inverted)', borderRadius: 'var(--radius-md)', padding: '8px 16px', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', cursor: 'pointer' }}>
              Create your first note
            </button>
          </div>
        )}
      </div>

      {showInfo && (
        <div className="notes-right-panel">
          <div className="row-between">
            <span className="notes-panel-label">Connections</span>
            <button
              onClick={() => setGraphExpanded(true)}
              title="Open the graph full size"
              aria-label="Open the graph full size"
              className="text-faint hover-text-accent"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'none',
                border: 'none',
                padding: '2px 4px',
                cursor: 'pointer',
                fontSize: '10px'
              }}
            >
              <Maximize2 size={11} />
              Expand
            </button>
          </div>

          <div
            style={{ height: '220px', flexShrink: 0, cursor: 'zoom-in' }}
            onDoubleClick={() => setGraphExpanded(true)}
          >
            <GraphView notes={notes} activeTitle={activeNoteTitle} onSelectNote={handleSelectNote} />
          </div>

          {activeNoteTitle && currentNoteMetadata && (
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                <span title={new Date(currentNoteMetadata.updatedAt).toLocaleString()}>Updated {formatRelativeTime(currentNoteMetadata.updatedAt)}</span>
                <span>{liveWordCount} words</span>
                <span>{formatBytes(currentNoteMetadata.size)}</span>
              </div>

              <div className="col">
                <div className="notes-panel-label row-6px">
                  <ArrowRight size={11} /> Outgoing links
                </div>
                {currentNoteMetadata.links.length > 0 ? (
                  currentNoteMetadata.links.map(link => {
                    const exists = noteExists(link)
                    return (
                      <button key={link} onClick={() => handleOpenWikiLink(link)} className="notes-link-chip">
                        {!exists && <FileWarning size={11} className="icon-warning" />}
                        <span className="truncate">{link}</span>
                        {!exists && <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', marginLeft: 'auto' }}>new</span>}
                      </button>
                    )
                  })
                ) : (
                  <span className="notes-empty-hint">No outgoing links.</span>
                )}
              </div>

              <div className="col">
                <div className="notes-panel-label row-6px">
                  <ArrowLeft size={11} /> Backlinks
                </div>
                {backlinks.length > 0 ? (
                  backlinks.map(link => (
                    <button key={link} onClick={() => handleSelectNote(link)} className="notes-link-chip">
                      <span className="truncate">{link}</span>
                    </button>
                  ))
                ) : (
                  <span className="notes-empty-hint">No backlinks pointing here.</span>
                )}
              </div>
            </div>
          )}

          {!activeNoteTitle && (
            <span className="notes-empty-hint mt-2">
              Select a note to see its links and metadata.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// one injected block shared with subcomponents
const NOTES_CSS = `
  .notes-layout-grid {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr) 320px;
    width: 100%;
    height: 100%;
    background: var(--color-background);
    overflow: hidden;
    transition: grid-template-columns var(--duration-normal) ease;
  }
  .notes-layout-grid.no-info {
    grid-template-columns: 260px minmax(0, 1fr);
  }
  .notes-sidebar {
    background: var(--color-surface-1);
    border-right: 1px solid var(--color-surface-offset);
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    min-width: 0;
  }
  .notes-editor-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    min-width: 0;
  }
  .notes-right-panel {
    background: var(--color-surface-1);
    border-left: 1px solid var(--color-surface-offset);
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    padding: var(--space-4);
    gap: var(--space-4);
    min-width: 0;
  }
  .notes-editor-header {
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface-1);
    border-bottom: 1px solid var(--color-surface-offset);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-shrink: 0;
  }
  .notes-title-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--color-text-base);
    outline: none;
    flex: 1;
    min-width: 0;
    padding: 2px 0;
    transition: border-color var(--duration-fast);
  }
  .notes-title-input:focus { border-bottom-color: var(--color-primary); }
  .notes-save-status {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: var(--weight-bold);
    color: var(--color-text-faint);
    white-space: nowrap;
  }
  .notes-save-status[data-dirty="true"] { color: var(--color-warning); }
  .notes-list-item {
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    border-bottom: 1px solid var(--color-surface-offset);
    transition: background var(--duration-fast);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .notes-list-item:hover { background: var(--color-surface-offset); }
  .notes-list-item.active {
    background: var(--color-primary-muted);
    box-shadow: inset 3px 0 0 var(--color-primary);
  }
  .notes-pin-toggle {
    background: none;
    border: none;
    color: var(--color-text-faint);
    cursor: pointer;
    padding: 2px;
    display: flex;
    opacity: 0;
    flex-shrink: 0;
    transition: opacity var(--duration-fast), color var(--duration-fast);
  }
  .notes-list-item:hover .notes-pin-toggle { opacity: 1; }
  .notes-pin-toggle:hover { color: var(--color-secondary); }
  .segment-btn {
    background: var(--color-surface-2);
    border: 1px solid var(--color-surface-offset);
    color: var(--color-text-muted);
    padding: 5px 10px;
    font-size: var(--text-xs);
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: all var(--duration-fast);
  }
  .segment-btn:hover { color: var(--color-text-base); background: var(--color-surface-offset); }
  .segment-btn.active { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
  .notes-icon-btn {
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 5px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    transition: all var(--duration-fast);
  }
  .notes-icon-btn:hover { color: var(--color-text-base); background: var(--color-surface-offset); }
  .notes-icon-btn:disabled { color: var(--color-text-faint); cursor: default; opacity: 0.5; }
  .notes-icon-btn-danger:hover { color: var(--color-error); }
  .note-tool-btn {
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 5px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    transition: all var(--duration-fast);
  }
  .note-tool-btn:hover { color: var(--color-text-base); background: var(--color-surface-offset); }
  .notes-menu-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 7px 10px;
    cursor: pointer;
    transition: background var(--duration-fast);
  }
  .notes-menu-item:hover { background: var(--color-surface-offset); }
  .notes-sort-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    font-size: 10px;
    font-weight: var(--weight-semibold);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    transition: all var(--duration-fast);
  }
  .notes-sort-btn:hover { color: var(--color-text-base); background: var(--color-surface-2); }
  .notes-textarea {
    flex: 1;
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    color: var(--color-text-base);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    padding: var(--space-4);
    resize: none;
    outline: none;
  }
  .notes-link-chip {
    background: var(--color-surface-2);
    border: 1px solid var(--color-surface-offset);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    font-size: var(--text-xs);
    color: var(--color-text-base);
    text-align: left;
    cursor: pointer;
    transition: border-color var(--duration-fast);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .notes-link-chip:hover { border-color: var(--color-secondary); }
  .notes-panel-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: var(--weight-bold);
    color: var(--color-text-faint);
  }
  .notes-empty-hint {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    font-style: italic;
  }
  .notes-spin { animation: spin 0.8s linear infinite; }
  .markdown-preview {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    padding: var(--space-4) var(--space-6);
    color: var(--color-text-base);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    min-width: 0;
  }
  .markdown-preview p { margin-bottom: var(--space-3); }
  .markdown-preview h1 {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    margin-top: var(--space-4);
    margin-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-surface-offset);
    padding-bottom: 4px;
  }
  .markdown-preview h2 { font-size: var(--text-lg); font-weight: var(--weight-semibold); margin-top: var(--space-4); margin-bottom: var(--space-2); }
  .markdown-preview h3 { font-size: var(--text-base); font-weight: var(--weight-semibold); margin-top: var(--space-3); margin-bottom: var(--space-1); }
  .markdown-preview ul, .markdown-preview ol { margin-left: var(--space-4); margin-bottom: var(--space-3); }
  .markdown-preview li { margin-bottom: var(--space-1); }
  .markdown-preview blockquote {
    border-left: 3px solid var(--color-surface-offset);
    padding-left: var(--space-3);
    color: var(--color-text-muted);
    margin: var(--space-3) 0;
  }
  .markdown-preview code {
    background: var(--color-surface-offset);
    padding: 2px 5px;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .markdown-preview pre { background: var(--color-surface-2); padding: var(--space-3); border-radius: var(--radius-md); overflow-x: auto; margin: var(--space-3) 0; }
  .markdown-preview pre code { background: transparent; padding: 0; }
  .markdown-preview table { border-collapse: collapse; margin: var(--space-3) 0; width: 100%; }
  .markdown-preview th, .markdown-preview td { border: 1px solid var(--color-surface-offset); padding: 6px 10px; text-align: left; font-size: var(--text-xs); }
  .markdown-preview th { background: var(--color-surface-2); font-weight: var(--weight-semibold); }
  .markdown-preview a { color: var(--color-primary); }
  .markdown-preview hr { border: none; border-top: 1px solid var(--color-surface-offset); margin: var(--space-4) 0; }
  .tag-pill {
    font-size: var(--text-2xs);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    border: 1px solid var(--color-surface-offset);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all var(--duration-fast);
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .tag-pill:hover { border-color: var(--color-balance); color: var(--color-text-base); }
  .tag-pill.active { background: var(--color-secondary-muted); border-color: var(--color-secondary); color: var(--color-secondary); }

  @media (max-width: 1100px) {
    .notes-layout-grid, .notes-layout-grid.no-info { grid-template-columns: 240px minmax(0, 1fr); }
    .notes-right-panel { display: none; }
  }
  @media (max-width: 680px) {
    .notes-layout-grid, .notes-layout-grid.no-info { grid-template-columns: minmax(0, 1fr); }
    .notes-sidebar { display: none; }
  }
`
