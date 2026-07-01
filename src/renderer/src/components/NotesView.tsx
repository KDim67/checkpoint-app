import React, { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react'
import { Plus, Search, Trash2, Save, FileText, Eye, Edit3, Columns, Hash, Link as LinkIcon, AlertCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'
import { useToast } from './ui/Toast'
import GraphView from './notes/GraphView'
import type { NoteMetadata } from '../../../shared/types'

// Initialize Mermaid for local dark theme diagram rendering
try {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    themeVariables: {
      background: '#131622',
      primaryColor: '#1e45fc',
      secondaryColor: '#cdf12b',
      lineColor: '#535e85',
      textColor: '#f1f5f9'
    }
  })
} catch (err) {
  console.error('Failed to initialize mermaid:', err)
}

// Inline Mermaid chart renderer component
function MermaidChart({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const reactId = useId()
  const elementId = `mermaid-${reactId.replace(/:/g, '')}`

  useEffect(() => {
    let isMounted = true
    setError(null)

    const renderChart = async () => {
      try {
        // Clear elements from previous renders if any
        const { svg: renderedSvg } = await mermaid.render(elementId, code)
        if (isMounted) {
          setSvg(renderedSvg)
        }
      } catch (err) {
        console.error('Mermaid render error:', err)
        if (isMounted) {
          const errMsg = err instanceof Error ? err.message : String(err)
          setError(errMsg || 'Failed to render Mermaid chart')
        }
      }
    }

    renderChart()
    return () => {
      isMounted = false
    }
  }, [code, elementId])

  if (error) {
    return (
      <pre style={{
        color: 'var(--color-error)',
        background: 'var(--color-error-muted)',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap'
      }}>
        {error}
      </pre>
    )
  }

  if (!svg) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontStyle: 'italic', padding: 'var(--space-2)' }}>
        Rendering diagram...
      </div>
    )
  }

  return (
    <div
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-surface-2)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-surface-offset)',
        overflowX: 'auto',
        margin: 'var(--space-4) 0'
      }}
    />
  )
}

export default function NotesView() {
  const { toast } = useToast()

  // State
  const [notes, setNotes] = useState<NoteMetadata[]>([])
  const [activeNoteTitle, setActiveNoteTitle] = useState<string | null>(null)
  const [activeNoteContent, setActiveNoteContent] = useState<string>('')
  const [tempTitle, setTempTitle] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('split')
  const [isDirty, setIsDirty] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [pendingDeleteTitle, setPendingDeleteTitle] = useState<string | null>(null)

  // Character and Word count computations
  const charCount = useMemo(() => {
    return activeNoteContent.length
  }, [activeNoteContent])

  const wordCount = useMemo(() => {
    const trimmed = activeNoteContent.trim()
    if (!trimmed) return 0
    return trimmed.split(/\s+/).length
  }, [activeNoteContent])

  // Fetch Notes List
  const loadNotesList = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.notes.listNotes()
      setNotes(list)
    } catch (err) {
      console.error('Failed to list notes:', err)
      toast('Failed to load notes', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadNotesList()
  }, [loadNotesList])

  // Load Note Content
  const loadNoteContent = useCallback(async (title: string) => {
    try {
      const content = await window.electronAPI.notes.readNote(title)
      setActiveNoteContent(content)
      setTempTitle(title)
      setIsDirty(false)
    } catch (err) {
      console.error('Failed to read note content:', err)
      toast('Failed to read note', { type: 'error' })
    }
  }, [toast])

  useEffect(() => {
    if (activeNoteTitle) {
      loadNoteContent(activeNoteTitle)
    } else {
      setActiveNoteContent('')
      setTempTitle('')
      setIsDirty(false)
    }
  }, [activeNoteTitle, loadNoteContent])

  // Save / Auto-Save Debouncer
  const handleSaveNote = useCallback(async () => {
    if (!activeNoteTitle) return

    let finalTitle = tempTitle.trim()
    if (!finalTitle) {
      toast('Note title cannot be empty. Reverting to original title.', { type: 'error' })
      finalTitle = activeNoteTitle
      setTempTitle(activeNoteTitle)
    }

    try {
      await window.electronAPI.notes.writeNote(
        finalTitle,
        activeNoteContent,
        activeNoteTitle
      )
      setIsDirty(false)
      if (activeNoteTitle !== finalTitle) {
        setActiveNoteTitle(finalTitle)
      }
      // Refresh list
      const list = await window.electronAPI.notes.listNotes()
      setNotes(list)
    } catch (err) {
      console.error('Failed to save note:', err)
      toast('Failed to save note', { type: 'error' })
    }
  }, [activeNoteTitle, tempTitle, activeNoteContent, toast])

  const handleSwitchNote = useCallback(async (newTitle: string | null) => {
    if (isDirty && activeNoteTitle) {
      await handleSaveNote()
    }
    setActiveNoteTitle(newTitle)
  }, [isDirty, activeNoteTitle, handleSaveNote])

  // Auto-save debouncer: saves changes 1.5s after editing halts
  useEffect(() => {
    if (!activeNoteTitle || !isDirty) return
    const timer = setTimeout(() => {
      handleSaveNote()
    }, 1500)
    return () => clearTimeout(timer)
  }, [activeNoteContent, tempTitle, isDirty, activeNoteTitle, handleSaveNote])

  // Keyboard shortcut Ctrl+S, only toast if a save actually fires
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (activeNoteTitle && isDirty) {
          handleSaveNote()
          if (tempTitle.trim()) {
            toast('Note saved', { type: 'success' })
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveNote, toast, activeNoteTitle, tempTitle, isDirty])

  // Note Action Handlers
  const handleCreateNote = async () => {
    if (isDirty && activeNoteTitle) {
      await handleSaveNote()
    }
    // Generate a unique title
    let count = 0
    let newTitle = 'Untitled Note'
    const existingTitles = new Set(notes.map(n => n.title.toLowerCase()))

    while (existingTitles.has(newTitle.toLowerCase())) {
      count++
      newTitle = `Untitled Note ${count}`
    }

    try {
      const defaultContent = `# ${newTitle}\n\nStart writing notes here...`
      await window.electronAPI.notes.writeNote(newTitle, defaultContent)
      toast('Note created', { type: 'success' })

      // Refresh list and activate new note
      const list = await window.electronAPI.notes.listNotes()
      setNotes(list)
      setActiveNoteTitle(newTitle)
      setMode('edit')
    } catch (err) {
      console.error('Failed to create note:', err)
      toast('Failed to create note', { type: 'error' })
    }
  }

  const handleDeleteNote = async (title: string) => {
    // Use inline confirmation state instead of blocking window.confirm()
    setPendingDeleteTitle(title)
  }

  const confirmDeleteNote = async () => {
    if (!pendingDeleteTitle) return
    const title = pendingDeleteTitle
    setPendingDeleteTitle(null)
    try {
      await window.electronAPI.notes.deleteNote(title)
      toast('Note deleted', { type: 'success' })
      setActiveNoteTitle(null)
      loadNotesList()
    } catch (err) {
      console.error('Failed to delete note:', err)
      toast('Failed to delete note', { type: 'error' })
    }
  }

  const handleOpenWikiLink = (title: string) => {
    const titleLower = title.toLowerCase()
    const match = notes.find(n => n.title.toLowerCase() === titleLower)

    if (match) {
      // Load existing note
      handleSwitchNote(match.title)
    } else {
      // Create new note, use toast instead of blocking confirm()
      toast(`Creating note "${title}"…`, { type: 'info' })
      createNamedNote(title)
    }
  }

  const createNamedNote = async (title: string) => {
    if (isDirty && activeNoteTitle) {
      await handleSaveNote()
    }
    try {
      const defaultContent = `# ${title}\n\nCreated from Wiki Link.`
      await window.electronAPI.notes.writeNote(title, defaultContent)
      toast(`Created note "${title}"`, { type: 'success' })

      const list = await window.electronAPI.notes.listNotes()
      setNotes(list)
      setActiveNoteTitle(title)
      setMode('edit')
    } catch (err) {
      console.error('Failed to create named note:', err)
      toast('Failed to create linked note', { type: 'error' })
    }
  }

  // Filter Computations
  const uniqueTags = useMemo(() => {
    const tagsSet = new Set<string>()
    notes.forEach(note => {
      note.tags.forEach(t => tagsSet.add(t))
    })
    return Array.from(tagsSet).sort()
  }, [notes])

  const filteredNotesList = useMemo(() => {
    return notes.filter(note => {
      const matchesSearch =
        note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))

      const matchesTag = selectedTag ? note.tags.includes(selectedTag) : true

      return matchesSearch && matchesTag
    })
  }, [notes, searchQuery, selectedTag])

  // Backlink computations
  const currentNoteMetadata = useMemo(() => {
    if (!activeNoteTitle) return null
    return notes.find(n => n.title === activeNoteTitle) || null
  }, [notes, activeNoteTitle])

  const backlinks = useMemo(() => {
    if (!activeNoteTitle) return []
    const titleLower = activeNoteTitle.toLowerCase()
    return notes
      .filter(n => n.title !== activeNoteTitle && n.links.some(l => l.toLowerCase() === titleLower))
      .map(n => n.title)
  }, [notes, activeNoteTitle])

  // Render-time Wiki-link Markdown Transformer
  const processedMarkdown = useMemo(() => {
    // Replaces [[Wiki Link]] with [Wiki Link](#wiki-link-Wiki%20Link) for markdown parser compatibility
    return activeNoteContent.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
      const encoded = encodeURIComponent(title.trim())
      return `[${title.trim()}](#wiki-link-${encoded})`
    })
  }, [activeNoteContent])

  return (
    <div className="notes-layout-grid">
      <style>{`
        .notes-layout-grid {
          display: grid;
          grid-template-columns: 240px 1fr 300px;
          width: 100%;
          height: 100%;
          background: var(--color-background);
          overflow: hidden;
          transition: grid-template-columns 0.2s ease;
        }
        .notes-editor-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          border-right: 1px solid var(--color-surface-offset);
        }
        .notes-right-panel {
          background: var(--color-surface-1);
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          padding: var(--space-4);
          gap: var(--space-4);
          flex-shrink: 0;
          width: 300px;
        }
        .notes-sidebar {
          background: var(--color-surface-1);
          border-right: 1px solid var(--color-surface-offset);
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .notes-list-item {
          padding: var(--space-3) var(--space-4);
          cursor: pointer;
          border-bottom: 1px solid var(--color-surface-offset);
          transition: all var(--duration-fast);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .notes-list-item:hover {
          background: var(--color-surface-offset);
        }
        .notes-list-item.active {
          background: var(--color-primary-muted);
          border-left: 3px solid var(--color-primary);
        }
        .segment-btn {
          background: var(--color-surface-2);
          border: 1px solid var(--color-surface-offset);
          color: var(--color-text-muted);
          padding: 6px 12px;
          font-size: var(--text-xs);
          cursor: pointer;
          transition: all var(--duration-fast);
        }
        .segment-btn:hover {
          color: var(--color-text-base);
          background: var(--color-surface-offset);
        }
        .segment-btn.active {
          background: var(--color-primary);
          border-color: var(--color-primary);
          color: white;
        }
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
        .markdown-preview {
          flex: 1;
          height: 100%;
          overflow-y: auto;
          padding: var(--space-4) var(--space-6);
          color: var(--color-text-base);
          font-size: var(--text-sm);
          line-height: var(--leading-relaxed);
        }
        .markdown-preview p {
          margin-bottom: var(--space-3);
        }
        .markdown-preview h1 {
          font-size: var(--text-xl);
          font-weight: var(--weight-bold);
          margin-top: var(--space-4);
          margin-bottom: var(--space-3);
          border-bottom: 1px solid var(--color-surface-offset);
          padding-bottom: 4px;
        }
        .markdown-preview h2 {
          font-size: var(--text-lg);
          font-weight: var(--weight-semibold);
          margin-top: var(--space-4);
          margin-bottom: var(--space-2);
        }
        .markdown-preview h3 {
          font-size: var(--text-sm);
          font-weight: var(--weight-semibold);
          margin-top: var(--space-3);
          margin-bottom: var(--space-1);
        }
        .markdown-preview ul, .markdown-preview ol {
          margin-left: var(--space-4);
          margin-bottom: var(--space-3);
        }
        .markdown-preview li {
          margin-bottom: var(--space-1);
        }
        .markdown-preview code {
          background: var(--color-surface-offset);
          padding: 2px 5px;
          border-radius: var(--radius-sm);
          font-family: var(--font-mono);
          font-size: var(--text-xs);
        }
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

        /* Responsive Media Queries */
        @media (max-width: 900px) {
          .notes-layout-grid {
            grid-template-columns: 240px 1fr 0px;
          }
          .notes-right-panel {
            display: none !important;
          }
        }
        @media (max-width: 650px) {
          .notes-layout-grid {
            grid-template-columns: 0px 1fr 0px;
          }
          .notes-sidebar {
            display: none !important;
          }
          .notes-right-panel {
            display: none !important;
          }
        }
          gap: 2px;
        }
        .tag-pill:hover {
          border-color: var(--color-balance);
          color: var(--color-text-base);
        }
        .tag-pill.active {
          background: var(--color-secondary-muted);
          border-color: var(--color-secondary);
          color: var(--color-secondary);
        }
      `}</style>

      {/* COLUMN 1: SIDEBAR (Notes & Tags) */}
      <div className="notes-sidebar">
        {/* Sidebar Header */}
        <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderBottom: '1px solid var(--color-surface-offset)', flexShrink: 0 }}>
          <button
            onClick={handleCreateNote}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              background: 'var(--color-secondary)',
              color: 'var(--color-text-inverted)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '8px',
              fontWeight: 'var(--weight-bold)',
              cursor: 'pointer'
            }}
          >
            <Plus size={16} />
            New Note
          </button>

          {/* Search bar */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--color-text-faint)' }} />
            <input
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-base)',
                fontSize: 'var(--text-xs)',
                padding: '6px 12px 6px 30px',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* Notes List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)', textAlign: 'center' }}>
              Loading notes...
            </div>
          ) : filteredNotesList.length === 0 ? (
            <div style={{ padding: 'var(--space-6)', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)', textAlign: 'center' }}>
              No notes found.
            </div>
          ) : (
            filteredNotesList.map(note => {
              const isActive = note.title === activeNoteTitle
              return (
                <div
                  key={note.title}
                  className={`notes-list-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleSwitchNote(note.title)}
                >
                  <span style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {note.title}
                  </span>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
                    {note.tags.map(tag => (
                      <span key={tag} style={{ fontSize: '9px', background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)', padding: '1px 4px', borderRadius: 'var(--radius-sm)' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Tags sidebar list */}
        {uniqueTags.length > 0 && (
          <div style={{ padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--color-surface-offset)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: '180px', overflowY: 'auto', flexShrink: 0 }}>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)' }}>
              Tags
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-1-5)', flexWrap: 'wrap' }}>
              {uniqueTags.map(tag => {
                const isActive = selectedTag === tag
                return (
                  <button
                    key={tag}
                    className={`tag-pill ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedTag(isActive ? null : tag)}
                  >
                    <Hash size={10} />
                    {tag.replace('#', '')}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* COLUMN 2: EDITOR / PREVIEWER */}
      <div className="notes-editor-panel">
        {activeNoteTitle ? (
          <>
            {/* Header toolbar */}
            <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--color-surface-1)', borderBottom: '1px solid var(--color-surface-offset)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              {/* Title input */}
              <input
                type="text"
                value={tempTitle}
                onChange={e => {
                  setTempTitle(e.target.value)
                  setIsDirty(true)
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 'var(--text-base)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--color-text-base)',
                  outline: 'none',
                  width: '240px'
                }}
              />

              {/* Toolbar Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                {/* Segment Controls */}
                <div style={{ display: 'flex', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  <button
                    className={`segment-btn ${mode === 'edit' ? 'active' : ''}`}
                    onClick={() => setMode('edit')}
                    title="Edit markdown"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    className={`segment-btn ${mode === 'preview' ? 'active' : ''}`}
                    onClick={() => setMode('preview')}
                    title="Live preview"
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    className={`segment-btn ${mode === 'split' ? 'active' : ''}`}
                    onClick={() => setMode('split')}
                    title="Side-by-side split screen"
                  >
                    <Columns size={14} />
                  </button>
                </div>

                {/* Save & Delete */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <button
                    onClick={handleSaveNote}
                    disabled={!isDirty}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: isDirty ? 'var(--color-secondary)' : 'var(--color-surface-2)',
                      color: isDirty ? 'var(--color-text-inverted)' : 'var(--color-text-faint)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      padding: '5px 10px',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 'var(--weight-semibold)',
                      cursor: isDirty ? 'pointer' : 'default',
                      transition: 'all 0.15s'
                    }}
                  >
                    <Save size={12} />
                    {isDirty ? 'Save' : 'Saved'}
                  </button>

                  {pendingDeleteTitle === activeNoteTitle ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>Delete?</span>
                      <button
                        onClick={confirmDeleteNote}
                        style={{ background: 'var(--color-error)', border: 'none', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: 'var(--text-xs)', cursor: 'pointer' }}
                      >Yes</button>
                      <button
                        onClick={() => setPendingDeleteTitle(null)}
                        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)', borderRadius: '4px', padding: '2px 6px', fontSize: 'var(--text-xs)', cursor: 'pointer' }}
                      >No</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDeleteNote(activeNoteTitle)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                        padding: '4px'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                      title="Delete Note"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Split / Editor Panel */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
              {(mode === 'edit' || mode === 'split') && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <textarea
                    className="notes-textarea"
                    value={activeNoteContent}
                    onChange={e => {
                      setActiveNoteContent(e.target.value)
                      setIsDirty(true)
                    }}
                    placeholder="Type in markdown... Use #tags to organize or [[Wiki Links]] to connect notes."
                  />
                  <div style={{
                    padding: '6px var(--space-4)',
                    background: 'var(--color-surface-1)',
                    borderTop: '1px solid var(--color-surface-offset)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px',
                    fontSize: '10px',
                    color: 'var(--color-text-faint)',
                    userSelect: 'none'
                  }}>
                    <span>{charCount} characters</span>
                    <span>{wordCount} words</span>
                  </div>
                </div>
              )}

              {mode === 'split' && (
                <div style={{ width: '1px', background: 'var(--color-surface-offset)', height: '100%' }} />
              )}

              {(mode === 'preview' || mode === 'split') && (
                <div className="markdown-preview">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Custom link renderer: intercept wiki-links
                      a: ({ href, children, ...props }) => {
                        if (href && href.startsWith('#wiki-link-')) {
                          const title = decodeURIComponent(href.replace('#wiki-link-', ''))
                          return (
                            <a
                              href="#"
                              onClick={e => {
                                e.preventDefault()
                                handleOpenWikiLink(title)
                              }}
                              style={{ color: 'var(--color-secondary)', textDecoration: 'underline', fontWeight: 'var(--weight-semibold)' }}
                            >
                              {children}
                            </a>
                          )
                        }
                        return (
                          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }} {...props}>
                            {children}
                          </a>
                        )
                      },
                      // Custom code renderer: render Mermaid diagrams inline
                      code: ({ className, children, ...props }) => {
                        const match = /language-mermaid/.exec(className || '')
                        if (match) {
                          return <MermaidChart code={String(children).trim()} />
                        }
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        )
                      }
                    }}
                  >
                    {processedMarkdown}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', color: 'var(--color-text-faint)' }}>
            <FileText size={48} style={{ opacity: 0.5 }} />
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>
              No note selected
            </div>
            <button
              onClick={handleCreateNote}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-muted)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 12px',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-balance)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
            >
              Create note
            </button>
          </div>
        )}
      </div>

      {/* COLUMN 3: RIGHT PANEL (Graph & Connected Backlinks) */}
      <div className="notes-right-panel">
        <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)' }}>
          Note Connections
        </span>

        {/* SVG connection graph */}
        <div style={{ height: '240px', flexShrink: 0 }}>
          <GraphView
            notes={notes}
            activeTitle={activeNoteTitle}
            onSelectNote={handleOpenWikiLink}
          />
        </div>

        {/* Backlinks / outgoing links panel */}
        {activeNoteTitle && (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
            {/* Outgoing links list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)' }}>
                <LinkIcon size={10} />
                Outgoing Links
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {currentNoteMetadata && currentNoteMetadata.links.length > 0 ? (
                  currentNoteMetadata.links.map(link => (
                    <button
                      key={link}
                      onClick={() => handleOpenWikiLink(link)}
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px 8px',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-base)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-secondary)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
                    >
                      {link}
                    </button>
                  ))
                ) : (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>
                    No outgoing links.
                  </span>
                )}
              </div>
            </div>

            {/* Backlinks list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)' }}>
                <LinkIcon size={10} />
                Backlinks
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {backlinks.length > 0 ? (
                  backlinks.map(link => (
                    <button
                      key={link}
                      onClick={() => handleOpenWikiLink(link)}
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px 8px',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-base)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-secondary)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
                    >
                      {link}
                    </button>
                  ))
                ) : (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>
                    No backlinks pointing here.
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
