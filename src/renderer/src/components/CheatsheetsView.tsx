import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Search, FileText, Trash2, Edit3, UploadCloud, X, BookOpen, ExternalLink, RefreshCw, Pin, Sparkles, FileType2, Copy, Check, ChevronUp, ChevronDown, ArrowDownAZ, Clock, HardDrive } from 'lucide-react'
import { useToast } from './ui/Toast'
import ConfirmDialog from './ui/ConfirmDialog'
import { useAppStore } from '../store/appStore'
import { useAiEnabled } from '../lib/useAiEnabled'
import { errorMessage } from '../../../shared/errors'

interface CheatsheetFile {
  name: string
  path: string
  size: number
  mtime: number
}

interface ContentSearchResult {
  name: string
  matchCount: number
  snippets: string[]
}

type SortMode = 'recent' | 'name' | 'size'
type ViewMode = 'pdf' | 'text'

const SORT_LABELS: Record<SortMode, { label: string; icon: React.ReactNode }> = {
  recent: { label: 'Recent', icon: <Clock size={11} /> },
  name: { label: 'Name', icon: <ArrowDownAZ size={11} /> },
  size: { label: 'Size', icon: <HardDrive size={11} /> }
}

export default function CheatsheetsView() {
  const { toast } = useToast()
  const setRightPanelContent = useAppStore(s => s.setRightPanelContent)
  const aiEnabled = useAiEnabled()

  const [cheatsheets, setCheatsheets] = useState<CheatsheetFile[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPdf, setSelectedPdf] = useState<CheatsheetFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [dragOver, setDragOver] = useState(false)

  // Pins & sorting
  const [pinned, setPinned] = useState<string[]>([])
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try { return (localStorage.getItem('checkpoint_cheatsheet_sort') as SortMode) || 'recent' } catch { return 'recent' }
  })

  // Cross-document content search
  const [contentResults, setContentResults] = useState<ContentSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  // Viewer: PDF or extracted-text mode
  const [viewMode, setViewMode] = useState<ViewMode>('pdf')
  const [textContent, setTextContent] = useState<string>('')
  const [textLoading, setTextLoading] = useState(false)
  const [textQuery, setTextQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const [copied, setCopied] = useState(false)
  const textContainerRef = useRef<HTMLDivElement>(null)

  // Modals / Actions state
  const [renamePdf, setRenamePdf] = useState<CheatsheetFile | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deletePdf, setDeletePdf] = useState<CheatsheetFile | null>(null)

  const dragCounter = useRef(0)

  // Fetch Cheatsheets + Pins
  const loadCheatsheets = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.cheatsheets.list()
      setCheatsheets(list)
    } catch (err) {
      console.error('Failed to load cheatsheets:', err)
      toast('Failed to load cheatsheets list', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadCheatsheets()
    window.electronAPI.db.getSetting('cheatsheet_pins').then(raw => {
      if (typeof raw !== 'string' || !raw) return
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setPinned(parsed.filter(p => typeof p === 'string'))
      } catch { /* corrupt setting. Ignore */ }
    }).catch(() => {})
  }, [loadCheatsheets])

  const handleTogglePin = (name: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setPinned(prev => {
      const next = prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]
      window.electronAPI.db.setSetting('cheatsheet_pins', JSON.stringify(next)).catch(() => {})
      return next
    })
  }

  const handleSetSort = (mode: SortMode) => {
    setSortMode(mode)
    try { localStorage.setItem('checkpoint_cheatsheet_sort', mode) } catch {}
  }

  // Cross-document content search (debounced)
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 3) {
      setContentResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await window.electronAPI.cheatsheets.search(q)
        setContentResults(res)
      } catch (err) {
        console.warn('Cheatsheet content search failed:', err)
        setContentResults(null)
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Text mode: load extracted text for the selected sheet
  useEffect(() => {
    if (viewMode !== 'text' || !selectedPdf) return
    let cancelled = false
    setTextLoading(true)
    window.electronAPI.cheatsheets.getText(selectedPdf.name)
      .then(t => { if (!cancelled) setTextContent(t || '') })
      .catch(() => { if (!cancelled) setTextContent('') })
      .finally(() => { if (!cancelled) setTextLoading(false) })
    return () => { cancelled = true }
  }, [viewMode, selectedPdf])

  // Reset viewer state when switching sheets
  useEffect(() => {
    setTextQuery('')
    setActiveMatch(0)
    setCopied(false)
  }, [selectedPdf])

  // In-text search: highlighted segments + match count
  const { highlightedParts, matchCount } = useMemo(() => {
    if (!textContent) return { highlightedParts: null as React.ReactNode[] | null, matchCount: 0 }
    const q = textQuery.trim()
    if (q.length < 2) return { highlightedParts: [textContent], matchCount: 0 }

    const parts: React.ReactNode[] = []
    const lower = textContent.toLowerCase()
    const ql = q.toLowerCase()
    let pos = 0
    let idx: number
    let m = 0
    while ((idx = lower.indexOf(ql, pos)) !== -1 && m < 800) {
      parts.push(textContent.slice(pos, idx))
      parts.push(
        <mark
          key={m}
          data-match={m}
          style={{ background: 'rgba(205, 241, 43, 0.35)', color: 'var(--color-text-base)', borderRadius: '2px', padding: '0 1px' }}
        >
          {textContent.slice(idx, idx + q.length)}
        </mark>
      )
      pos = idx + q.length
      m++
    }
    parts.push(textContent.slice(pos))
    return { highlightedParts: parts, matchCount: m }
  }, [textContent, textQuery])

  // Scroll the active match into view and emphasize it
  useEffect(() => {
    const container = textContainerRef.current
    if (!container || matchCount === 0) return
    const marks = container.querySelectorAll('mark[data-match]')
    marks.forEach((el, i) => {
      ;(el as HTMLElement).style.outline = i === activeMatch ? '2px solid var(--color-secondary)' : 'none'
    })
    const target = marks[activeMatch] as HTMLElement | undefined
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeMatch, matchCount, highlightedParts])

  const gotoMatch = (dir: 1 | -1) => {
    if (matchCount === 0) return
    setActiveMatch(prev => (prev + dir + matchCount) % matchCount)
  }

  const handleCopyText = async () => {
    if (!textContent) return
    try {
      await navigator.clipboard.writeText(textContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }

  // Ask AI: attach the sheet to the assistant and open the panel
  const handleAskAi = (sheetName: string) => {
    setRightPanelContent('ai-chat')
    // Give the panel a tick to mount before dispatching the attach event
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('checkpoint-ai-attach-cheatsheet', { detail: { name: sheetName } }))
    }, 150)
    toast(`Attached "${sheetName.replace(/\.pdf$/i, '')}": ask away!`, { type: 'success' })
  }

  // Open a content-search hit: select the sheet in TEXT mode with the query
  // pre-filled, so the matches are highlighted and ready to step through.
  const handleOpenContentHit = (name: string) => {
    const sheet = cheatsheets.find(c => c.name === name)
    if (!sheet) return
    setSelectedPdf(sheet)
    setViewMode('text')
    setTimeout(() => {
      setTextQuery(searchQuery.trim())
      setActiveMatch(0)
    }, 0)
  }

  // Add File Actions
  const handleAddFile = async () => {
    try {
      const srcPath = await window.electronAPI.cheatsheets.selectFile()
      if (!srcPath) return // Canceled

      setLoading(true)
      const newName = await window.electronAPI.cheatsheets.add(srcPath)
      toast(`Successfully added cheatsheet: ${newName}`, { type: 'success' })
      await loadCheatsheets()
    } catch (err) {
      console.error('Failed to add cheatsheet:', err)
      toast(errorMessage(err, 'Failed to add cheatsheet file'), { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Drag & Drop Handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    dragCounter.current = 0

    const files = Array.from(e.dataTransfer.files)
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'))

    if (pdfs.length === 0) {
      toast('Only PDF files are supported.', { type: 'info' })
      return
    }

    setLoading(true)
    let addedCount = 0
    let lastError = ''

    for (const pdf of pdfs) {
      try {
        // Electron ≥32: File.path no longer exists. Resolve via preload webUtils
        const filePath = window.electronAPI.app.getPathForFile(pdf)
        if (filePath) {
          await window.electronAPI.cheatsheets.add(filePath)
          addedCount++
        }
      } catch (err) {
        lastError = errorMessage(err, 'Error uploading')
      }
    }

    if (addedCount > 0) {
      toast(`Successfully uploaded ${addedCount} cheatsheet(s)`, { type: 'success' })
    } else if (lastError) {
      toast(lastError, { type: 'error' })
    }

    await loadCheatsheets()
  }

  // Rename Action
  const handleRenameClick = (pdf: CheatsheetFile, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamePdf(pdf)
    const baseName = pdf.name.replace(/\.pdf$/i, '')
    setRenameName(baseName)
  }

  const handleRenameSubmit = async () => {
    if (!renamePdf) return
    const cleanName = renameName.trim()
    if (!cleanName) {
      toast('Filename cannot be empty.', { type: 'info' })
      return
    }

    try {
      await window.electronAPI.cheatsheets.rename(renamePdf.name, cleanName)
      toast('Cheatsheet renamed successfully', { type: 'success' })

      const newFileName = cleanName.toLowerCase().endsWith('.pdf') ? cleanName : `${cleanName}.pdf`

      // Keep pin pointing at the renamed file
      if (pinned.includes(renamePdf.name)) {
        setPinned(prev => {
          const next = prev.map(p => p === renamePdf.name ? newFileName : p)
          window.electronAPI.db.setSetting('cheatsheet_pins', JSON.stringify(next)).catch(() => {})
          return next
        })
      }

      if (selectedPdf && selectedPdf.name === renamePdf.name) {
        setSelectedPdf(prev => prev ? { ...prev, name: newFileName } : null)
      }

      setRenamePdf(null)
      await loadCheatsheets()
    } catch (err) {
      console.error('Failed to rename cheatsheet:', err)
      toast(errorMessage(err, 'Failed to rename cheatsheet'), { type: 'error' })
    }
  }

  // Delete Action
  const handleDeleteClick = (pdf: CheatsheetFile, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletePdf(pdf)
  }

  const handleDeleteConfirm = async () => {
    if (!deletePdf) return
    try {
      await window.electronAPI.cheatsheets.remove(deletePdf.name)
      toast('Cheatsheet deleted successfully', { type: 'success' })

      if (pinned.includes(deletePdf.name)) {
        setPinned(prev => {
          const next = prev.filter(p => p !== deletePdf.name)
          window.electronAPI.db.setSetting('cheatsheet_pins', JSON.stringify(next)).catch(() => {})
          return next
        })
      }
      if (selectedPdf && selectedPdf.name === deletePdf.name) {
        setSelectedPdf(null)
      }

      setDeletePdf(null)
      await loadCheatsheets()
    } catch (err) {
      console.error('Failed to delete cheatsheet:', err)
      toast(errorMessage(err, 'Failed to delete cheatsheet'), { type: 'error' })
    }
  }

  // Open in External Window
  const handleOpenExternal = () => {
    if (!selectedPdf) return
    const url = `cheatsheet://show/${encodeURIComponent(selectedPdf.name)}`
    window.electronAPI.app.openExternal(url)
  }

  // List derivation: name filter + pins + sort
  const { pinnedList, unpinnedList } = useMemo(() => {
    const q = searchQuery.toLowerCase()
    const filtered = cheatsheets.filter(c => c.name.toLowerCase().includes(q))
    const sorter = (a: CheatsheetFile, b: CheatsheetFile) =>
      sortMode === 'name' ? a.name.localeCompare(b.name)
      : sortMode === 'size' ? b.size - a.size
      : b.mtime - a.mtime
    return {
      pinnedList: filtered.filter(c => pinned.includes(c.name)).sort(sorter),
      unpinnedList: filtered.filter(c => !pinned.includes(c.name)).sort(sorter)
    }
  }, [cheatsheets, searchQuery, pinned, sortMode])

  // Content hits for sheets that did NOT already match by name (avoid dupes)
  const contentOnlyHits = useMemo(() => {
    if (!contentResults) return []
    const q = searchQuery.toLowerCase()
    return contentResults.filter(r => !r.name.toLowerCase().includes(q))
  }, [contentResults, searchQuery])

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const renderSheetItem = (pdf: CheatsheetFile) => {
    const isActive = selectedPdf?.name === pdf.name
    const isPinned = pinned.includes(pdf.name)
    const contentHit = contentResults?.find(r => r.name === pdf.name)
    return (
      <div
        key={pdf.name}
        className={`cheatsheet-item ${isActive ? 'active' : ''}`}
        onClick={() => setSelectedPdf(pdf)}
      >
        <FileText size={18} style={{ color: isActive ? 'var(--color-secondary)' : 'var(--color-text-muted)', flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-normal)',
              color: 'var(--color-text-base)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={pdf.name}
          >
            {isPinned && <Pin size={9} style={{ color: 'var(--color-secondary)', marginRight: '4px', display: 'inline' }} />}
            {pdf.name.replace(/\.pdf$/i, '')}
          </span>
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)' }}>
            {formatSize(pdf.size)} · {new Date(pdf.mtime).toLocaleDateString()}
            {contentHit && (
              <span style={{ color: 'var(--color-secondary)', fontWeight: 'var(--weight-bold)' }}>
                {' '}· {contentHit.matchCount} match{contentHit.matchCount > 1 ? 'es' : ''}
              </span>
            )}
          </span>
        </div>

        <div className="cheatsheet-item-actions">
          <button
            className="action-btn-small"
            onClick={(e) => handleTogglePin(pdf.name, e)}
            title={isPinned ? 'Unpin' : 'Pin to top'}
            style={isPinned ? { color: 'var(--color-secondary)', opacity: 1 } : undefined}
          >
            <Pin size={12} />
          </button>
          <button
            className="action-btn-small"
            onClick={(e) => { e.stopPropagation(); handleAskAi(pdf.name) }}
            title="Ask the AI Assistant about this cheatsheet"
          >
            <Sparkles size={12} />
          </button>
          <button
            className="action-btn-small"
            onClick={(e) => handleRenameClick(pdf, e)}
            title="Rename cheatsheet"
          >
            <Edit3 size={12} />
          </button>
          <button
            className="action-btn-small delete-btn"
            onClick={(e) => handleDeleteClick(pdf, e)}
            title="Delete cheatsheet"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        background: 'var(--color-background)',
        overflow: 'hidden',
        position: 'relative'
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <style>{`
        .cheatsheets-sidebar {
          width: 320px;
          border-right: 1px solid var(--color-surface-offset);
          display: flex;
          flex-direction: column;
          background: var(--color-surface-1);
          flex-shrink: 0;
        }
        .cheatsheets-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--color-background);
          position: relative;
        }
        .search-container {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          padding: var(--space-4) var(--space-4) var(--space-3);
          border-bottom: 1px solid var(--color-surface-offset);
        }
        .search-input-wrapper {
          position: relative;
          flex: 1;
        }
        .search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--color-text-faint);
        }
        .search-input {
          width: 100%;
          background: var(--color-surface-2);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-md);
          padding: 8px 10px 8px 32px;
          color: var(--color-text-base);
          font-size: var(--text-sm);
          outline: none;
          transition: border-color var(--duration-fast);
          box-sizing: border-box;
        }
        .search-input:focus {
          border-color: var(--color-secondary);
        }
        .sort-btn {
          background: transparent;
          border: 1px solid transparent;
          color: var(--color-text-faint);
          border-radius: var(--radius-sm);
          padding: 3px 8px;
          font-size: 10px;
          font-weight: var(--weight-medium);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: all var(--duration-fast);
        }
        .sort-btn:hover { color: var(--color-text-base); }
        .sort-btn.active {
          color: var(--color-secondary);
          background: var(--color-secondary-muted);
          border-color: var(--color-secondary);
        }
        .cheatsheet-list {
          flex: 1;
          overflow-y: auto;
          padding: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }
        .list-section-label {
          font-size: 9px;
          font-weight: var(--weight-bold);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-text-faint);
          padding: 2px var(--space-1);
        }
        .cheatsheet-item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3);
          border-radius: var(--radius-md);
          border: 1px solid var(--color-surface-offset);
          background: var(--color-surface-2);
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-default);
          position: relative;
          flex-shrink: 0;
        }
        .cheatsheet-item:hover {
          background: var(--color-surface-offset);
          border-color: var(--color-balance);
        }
        .cheatsheet-item.active {
          border-color: var(--color-secondary);
          background: var(--color-secondary-muted);
        }
        .cheatsheet-item-actions {
          display: flex;
          gap: 2px;
          opacity: 0;
          transition: opacity var(--duration-fast);
        }
        .cheatsheet-item:hover .cheatsheet-item-actions {
          opacity: 1;
        }
        .content-hit {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          border: 1px dashed var(--color-surface-offset);
          background: transparent;
          cursor: pointer;
          transition: all var(--duration-fast);
          flex-shrink: 0;
          text-align: left;
        }
        .content-hit:hover {
          border-color: var(--color-secondary);
          background: var(--color-surface-2);
        }
        .action-btn-small {
          background: transparent;
          border: none;
          color: var(--color-text-faint);
          padding: var(--space-1);
          border-radius: var(--radius-sm);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--duration-fast);
        }
        .action-btn-small:hover {
          color: var(--color-text-base);
          background: var(--color-surface-offset);
        }
        .action-btn-small.delete-btn:hover {
          color: var(--color-error);
          background: var(--color-error-muted);
        }
        .pdf-viewer-container {
          flex: 1;
          width: 100%;
          height: 100%;
          border: none;
          background: var(--color-background);
        }
        .viewer-toolbar-btn {
          background: transparent;
          border: 1px solid var(--color-surface-offset);
          color: var(--color-text-base);
          border-radius: var(--radius-md);
          padding: 4px 10px;
          font-size: var(--text-2xs);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          transition: all var(--duration-fast);
          white-space: nowrap;
        }
        .viewer-toolbar-btn:hover { border-color: var(--color-balance); }
        .viewer-toolbar-btn.primary {
          background: var(--color-secondary);
          border-color: var(--color-secondary);
          color: var(--color-text-inverted);
          font-weight: var(--weight-bold);
        }
        .viewer-toolbar-btn.mode-active {
          background: var(--color-secondary-muted);
          border-color: var(--color-secondary);
          color: var(--color-secondary);
          font-weight: var(--weight-bold);
        }
        .drag-overlay {
          position: absolute;
          inset: 0;
          background: rgba(11, 12, 16, 0.85);
          backdrop-filter: blur(4px);
          border: 2px dashed var(--color-secondary);
          margin: var(--space-4);
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-3);
          z-index: 1000;
          color: var(--color-secondary);
          animation: fade-in 0.15s ease-out;
          pointer-events: none;
        }
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
        }
        .modal-box {
          background: var(--color-surface-1);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-lg);
          padding: var(--space-5);
          width: 100%;
          max-width: 420px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }
        .btn-glow {
          background: var(--color-secondary);
          color: var(--color-text-inverted);
          border: none;
          font-weight: var(--weight-bold);
          border-radius: var(--radius-md);
          padding: 8px 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: var(--space-2);
          transition: all var(--duration-fast);
        }
        .btn-glow:hover {
          filter: brightness(1.15);
          box-shadow: 0 0 12px var(--color-secondary-muted);
        }
      `}</style>

      {/* Drag & Drop Overlay */}
      {dragOver && (
        <div className="drag-overlay">
          <UploadCloud size={48} className="animate-bounce" />
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)' }}>
            Drop PDF here to upload
          </h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
            Files will be copied to your local cheatsheets catalog
          </p>
        </div>
      )}

      {/* Left Sidebar List */}
      <div className="cheatsheets-sidebar">
        <div className="search-container">
          <div className="row">
            <div className="search-input-wrapper">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search names & contents…"
                className="search-input"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setSearchQuery('') }}
              />
            </div>
            <button
              onClick={handleAddFile}
              className="btn-glow"
              style={{ padding: '8px' }}
              title="Upload PDF Cheatsheet"
            >
              <Plus size={16} />
            </button>
          </div>

          {/* Sort row */}
          <div className="row-between">
            <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
              {cheatsheets.length} sheet{cheatsheets.length !== 1 ? 's' : ''}
              {searching && ' · searching…'}
            </span>
            <div style={{ display: 'flex', gap: '2px' }}>
              {(Object.keys(SORT_LABELS) as SortMode[]).map(mode => (
                <button
                  key={mode}
                  className={`sort-btn ${sortMode === mode ? 'active' : ''}`}
                  onClick={() => handleSetSort(mode)}
                  title={`Sort by ${SORT_LABELS[mode].label.toLowerCase()}`}
                >
                  {SORT_LABELS[mode].icon}
                  {SORT_LABELS[mode].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="cheatsheet-list">
          {loading && cheatsheets.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--color-text-muted)' }}>
              <RefreshCw size={20} className="animate-spin" />
            </div>
          ) : pinnedList.length === 0 && unpinnedList.length === 0 && contentOnlyHits.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 'var(--space-4)', textAlign: 'center', gap: 'var(--space-2)' }}>
              <BookOpen size={32} style={{ color: 'var(--color-text-faint)' }} />
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                {searchQuery ? 'No cheatsheets match your query.' : 'No cheatsheets added yet.'}
              </p>
              {!searchQuery && (
                <button
                  onClick={handleAddFile}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-secondary)',
                    borderRadius: 'var(--radius-md)',
                    padding: '6px 12px',
                    fontSize: 'var(--text-xs)',
                    cursor: 'pointer',
                    marginTop: 'var(--space-2)'
                  }}
                >
                  Browse PDF
                </button>
              )}
            </div>
          ) : (
            <>
              {pinnedList.length > 0 && (
                <>
                  <div className="list-section-label">📌 Pinned</div>
                  {pinnedList.map(renderSheetItem)}
                </>
              )}
              {unpinnedList.length > 0 && (
                <>
                  {pinnedList.length > 0 && <div className="list-section-label" style={{ marginTop: 'var(--space-2)' }}>All sheets</div>}
                  {unpinnedList.map(renderSheetItem)}
                </>
              )}

              {/* Content-search hits inside sheets whose NAME didn't match */}
              {contentOnlyHits.length > 0 && (
                <>
                  <div className="list-section-label" style={{ marginTop: 'var(--space-2)', color: 'var(--color-secondary)' }}>
                    Found inside
                  </div>
                  {contentOnlyHits.map(hit => (
                    <button
                      key={`hit-${hit.name}`}
                      className="content-hit"
                      onClick={() => handleOpenContentHit(hit.name)}
                      title="Open in text view with matches highlighted"
                    >
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <FileType2 size={12} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.name.replace(/\.pdf$/i, '')}</span>
                        <span style={{ fontSize: '9px', color: 'var(--color-secondary)', fontWeight: 'var(--weight-bold)', flexShrink: 0 }}>
                          {hit.matchCount} match{hit.matchCount > 1 ? 'es' : ''}
                        </span>
                      </span>
                      {hit.snippets[0] && (
                        <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {hit.snippets[0]}
                        </span>
                      )}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right Main Viewer */}
      <div className="cheatsheets-main">
        {selectedPdf ? (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
            {/* Header control bar */}
            <div
              style={{
                minHeight: '44px',
                borderBottom: '1px solid var(--color-surface-offset)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: '6px var(--space-4)',
                background: 'var(--color-surface-1)',
                flexShrink: 0,
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                <h2 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px', margin: 0 }}>
                  {selectedPdf.name.replace(/\.pdf$/i, '')}
                </h2>
                <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
                  {formatSize(selectedPdf.size)}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* PDF / Text mode toggle */}
                <div style={{ display: 'flex', gap: '2px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', padding: '2px' }}>
                  <button
                    className={`viewer-toolbar-btn ${viewMode === 'pdf' ? 'mode-active' : ''}`}
                    style={{ border: 'none' }}
                    onClick={() => setViewMode('pdf')}
                  >
                    <FileText size={12} /> PDF
                  </button>
                  <button
                    className={`viewer-toolbar-btn ${viewMode === 'text' ? 'mode-active' : ''}`}
                    style={{ border: 'none' }}
                    onClick={() => setViewMode('text')}
                    title="Extracted text. Searchable and copyable"
                  >
                    <FileType2 size={12} /> Text
                  </button>
                </div>

                {aiEnabled && <button className="viewer-toolbar-btn primary" onClick={() => handleAskAi(selectedPdf.name)} title="Attach to the AI Assistant and ask questions about it">
                  <Sparkles size={12} />
                  Ask AI
                </button>}

                <button className="viewer-toolbar-btn" onClick={handleOpenExternal}>
                  <ExternalLink size={12} />
                  Open Native
                </button>
              </div>
            </div>

            {/* Text-mode search bar */}
            {viewMode === 'text' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: '6px var(--space-4)',
                  borderBottom: '1px solid var(--color-surface-offset)',
                  background: 'var(--color-surface-2)',
                  flexShrink: 0
                }}
              >
                <div className="search-input-wrapper" style={{ maxWidth: '300px' }}>
                  <Search size={13} className="search-icon" />
                  <input
                    type="text"
                    className="search-input"
                    style={{ padding: '5px 8px 5px 30px', fontSize: 'var(--text-xs)' }}
                    placeholder="Find in document…"
                    value={textQuery}
                    onChange={e => { setTextQuery(e.target.value); setActiveMatch(0) }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') gotoMatch(e.shiftKey ? -1 : 1)
                      if (e.key === 'Escape') setTextQuery('')
                    }}
                  />
                </div>
                {textQuery.trim().length >= 2 && (
                  <span style={{ fontSize: '10px', color: matchCount > 0 ? 'var(--color-secondary)' : 'var(--color-text-faint)', fontWeight: 'var(--weight-bold)', whiteSpace: 'nowrap' }}>
                    {matchCount > 0 ? `${activeMatch + 1} / ${matchCount}` : 'No matches'}
                  </span>
                )}
                <button className="action-btn-small" onClick={() => gotoMatch(-1)} disabled={matchCount === 0} title="Previous match (Shift+Enter)">
                  <ChevronUp size={14} />
                </button>
                <button className="action-btn-small" onClick={() => gotoMatch(1)} disabled={matchCount === 0} title="Next match (Enter)">
                  <ChevronDown size={14} />
                </button>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
                    {textContent ? `${textContent.split(/\s+/).filter(Boolean).length.toLocaleString()} words` : ''}
                  </span>
                  <button className="viewer-toolbar-btn" onClick={handleCopyText} disabled={!textContent}>
                    {copied ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
                    {copied ? 'Copied!' : 'Copy Text'}
                  </button>
                </div>
              </div>
            )}

            {/* Viewport */}
            {viewMode === 'pdf' ? (
              <iframe
                title={selectedPdf.name}
                src={`cheatsheet://show/${encodeURIComponent(selectedPdf.name)}`}
                className="pdf-viewer-container"
              />
            ) : (
              <div
                ref={textContainerRef}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: 'var(--space-5) var(--space-6)',
                  background: 'var(--color-background)'
                }}
              >
                {textLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                    <RefreshCw size={14} className="animate-spin" />
                    Extracting text…
                  </div>
                ) : !textContent ? (
                  <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)', fontStyle: 'italic' }}>
                    No extractable text found in this PDF (it may be a scanned image).
                  </div>
                ) : (
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      lineHeight: 1.7,
                      color: 'var(--color-text-base)',
                      maxWidth: '860px'
                    }}
                  >
                    {highlightedParts}
                  </pre>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 'var(--space-6)', gap: 'var(--space-3)' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-faint)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}
            >
              <FileText size={32} />
            </div>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
              No Cheatsheet Selected
            </h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: '320px', lineHeight: 1.6 }}>
              Select a cheatsheet from the sidebar, or drag &amp; drop a PDF anywhere here to upload it.
              The search box also looks <strong>inside</strong> every sheet, and “Ask AI” lets the assistant answer from one.
            </p>
          </div>
        )}
      </div>

      {/* Rename Modal */}
      {renamePdf && (
        <div className="modal-overlay" onClick={() => setRenamePdf(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="row-between">
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                Rename Cheatsheet
              </h3>
              <button onClick={() => setRenamePdf(null)} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <div className="col">
              <label style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)' }}>
                New Name
              </label>
              <input
                type="text"
                className="search-input"
                style={{ paddingLeft: '10px' }}
                value={renameName}
                onChange={e => setRenameName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameSubmit()
                }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <button
                onClick={() => setRenamePdf(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-muted)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontSize: 'var(--text-xs)'
                }}
              >
                Cancel
              </button>
              <button onClick={handleRenameSubmit} className="btn-glow" style={{ fontSize: 'var(--text-xs)' }}>
                Save Name
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletePdf}
        title="Delete Cheatsheet"
        message={`Are you sure you want to delete "${deletePdf?.name}"? This file will be permanently removed from disk.`}
        confirmText="Delete File"
        isDestructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletePdf(null)}
      />
    </div>
  )
}
