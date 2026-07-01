import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Search, FileText, Trash2, Edit3, UploadCloud, X, BookOpen, ExternalLink, RefreshCw } from 'lucide-react'
import { useToast } from './ui/Toast'
import ConfirmDialog from './ui/ConfirmDialog'

interface CheatsheetFile {
  name: string
  path: string
  size: number
  mtime: number
}

export default function CheatsheetsView() {
  const { toast } = useToast()
  
  const [cheatsheets, setCheatsheets] = useState<CheatsheetFile[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPdf, setSelectedPdf] = useState<CheatsheetFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [dragOver, setDragOver] = useState(false)

  // Modals / Actions state
  const [renamePdf, setRenamePdf] = useState<CheatsheetFile | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deletePdf, setDeletePdf] = useState<CheatsheetFile | null>(null)

  const dragCounter = useRef(0)

  // Fetch Cheatsheets
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
  }, [loadCheatsheets])

  // Add File Actions
  const handleAddFile = async () => {
    try {
      const srcPath = await window.electronAPI.cheatsheets.selectFile()
      if (!srcPath) return // Canceled

      setLoading(true)
      const newName = await window.electronAPI.cheatsheets.add(srcPath)
      toast(`Successfully added cheatsheet: ${newName}`, { type: 'success' })
      await loadCheatsheets()
    } catch (err: any) {
      console.error('Failed to add cheatsheet:', err)
      toast(err.message || 'Failed to add cheatsheet file', { type: 'error' })
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
        // Drop objects in electron have file.path
        const filePath = (pdf as any).path
        if (filePath) {
          await window.electronAPI.cheatsheets.add(filePath)
          addedCount++
        }
      } catch (err: any) {
        lastError = err.message || 'Error uploading'
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
    // Pre-populate with filename without extension
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
      
      // Update selected PDF if renamed
      if (selectedPdf && selectedPdf.name === renamePdf.name) {
        setSelectedPdf(prev => prev ? { ...prev, name: newFileName } : null)
      }

      setRenamePdf(null)
      await loadCheatsheets()
    } catch (err: any) {
      console.error('Failed to rename cheatsheet:', err)
      toast(err.message || 'Failed to rename cheatsheet', { type: 'error' })
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
      
      // Clear selection if deleted
      if (selectedPdf && selectedPdf.name === deletePdf.name) {
        setSelectedPdf(null)
      }

      setDeletePdf(null)
      await loadCheatsheets()
    } catch (err: any) {
      console.error('Failed to delete cheatsheet:', err)
      toast(err.message || 'Failed to delete cheatsheet', { type: 'error' })
    }
  }

  // Open in External Window
  const handleOpenExternal = () => {
    if (!selectedPdf) return
    const url = `cheatsheet://show/${encodeURIComponent(selectedPdf.name)}`
    window.electronAPI.app.openExternal(url)
  }

  // Filtering list
  const filteredList = useMemo(() => {
    return cheatsheets.filter(c => 
      c.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [cheatsheets, searchQuery])

  // Helpers for file size formatting
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
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
          width: 300px;
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
          position: relative;
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-4);
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
        }
        .search-input:focus {
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
        }
        .cheatsheet-item:hover {
          transform: translateY(-1px);
          background: var(--color-surface-offset);
          border-color: var(--color-balance);
        }
        .cheatsheet-item.active {
          border-color: var(--color-secondary);
          background: var(--color-secondary-muted);
        }
        .cheatsheet-item-actions {
          display: flex;
          gap: var(--space-1);
          opacity: 0;
          transition: opacity var(--duration-fast);
        }
        .cheatsheet-item:hover .cheatsheet-item-actions {
          opacity: 1;
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
        @keyframes fade-in {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
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
          maxWidth: 420px;
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
          <div className="search-input-wrapper">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search cheatsheets..."
              className="search-input"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
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

        <div className="cheatsheet-list">
          {loading && cheatsheets.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--color-text-muted)' }}>
              <RefreshCw size={20} className="animate-spin" />
            </div>
          ) : filteredList.length === 0 ? (
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
            filteredList.map(pdf => (
              <div
                key={pdf.name}
                className={`cheatsheet-item ${selectedPdf?.name === pdf.name ? 'active' : ''}`}
                onClick={() => setSelectedPdf(pdf)}
              >
                <FileText size={18} style={{ color: selectedPdf?.name === pdf.name ? 'var(--color-secondary)' : 'var(--color-text-muted)', flexShrink: 0 }} />
                
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span
                    style={{
                      fontSize: 'var(--text-xs)',
                      fontWeight: selectedPdf?.name === pdf.name ? 'var(--weight-semibold)' : 'var(--weight-normal)',
                      color: 'var(--color-text-base)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={pdf.name}
                  >
                    {pdf.name.replace(/\.pdf$/i, '')}
                  </span>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)' }}>
                    {formatSize(pdf.size)}
                  </span>
                </div>

                <div className="cheatsheet-item-actions">
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
            ))
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
                height: '44px',
                borderBottom: '1px solid var(--color-surface-offset)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 var(--space-4)',
                background: 'var(--color-surface-1)',
                flexShrink: 0
              }}
            >
              <h2 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px' }}>
                {selectedPdf.name}
              </h2>
              
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  onClick={handleOpenExternal}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-md)',
                    padding: '4px 8px',
                    fontSize: 'var(--text-2xs)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <ExternalLink size={12} />
                  Open Native
                </button>
              </div>
            </div>

            {/* Native PDF renderer viewport */}
            <iframe
              title={selectedPdf.name}
              src={`cheatsheet://show/${encodeURIComponent(selectedPdf.name)}`}
              className="pdf-viewer-container"
            />
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
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: '300px' }}>
              Select a cheatsheet from the sidebar or drag and drop a PDF anywhere here to upload and view it.
            </p>
          </div>
        )}
      </div>

      {/* Rename Modal */}
      {renamePdf && (
        <div className="modal-overlay" onClick={() => setRenamePdf(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                Rename Cheatsheet
              </h3>
              <button onClick={() => setRenamePdf(null)} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
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
