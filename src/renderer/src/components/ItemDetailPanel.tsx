import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Calendar,
  Clock,
  AlertCircle,
  CheckSquare,
  Layout,
  Edit2,
  Tag as TagIcon,
  Check,
  ChevronDown,
  FileText
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import type { Item, Tag as TagType } from '../../../shared/types'
import Skeleton from './ui/Skeleton'
import { useToast } from './ui/Toast'
import ColorPicker from './ui/ColorPicker'
import { loadBoardConfig } from '../lib/boardConfig'

export default function ItemDetailPanel() {
  const selectedItemId = useAppStore(s => s.selectedItemId)
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const { toast } = useToast()

  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(false)
  const [columns, setColumns] = useState<Array<{ id: string; name: string }>>([])

  // Edit states
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState<0 | 1 | 2 | 3>(0)
  const [dueDate, setDueDate] = useState<string>('')
  const [isEditingBody, setIsEditingBody] = useState(false)

  // Tags states
  const [allTags, setAllTags] = useState<TagType[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [showTagSelector, setShowTagSelector] = useState(false)
  const [selectedTagColor, setSelectedTagColor] = useState('#3b82f6')

  const tagSelectorRef = useRef<HTMLDivElement>(null)

  // 1. Close tag selector on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (tagSelectorRef.current && !tagSelectorRef.current.contains(e.target as Node)) {
        setShowTagSelector(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  // 2. Fetch Columns and Tags. Re-runs on workspace change: columns are
  //    per-workspace, so a list loaded once at mount would describe whichever
  //    board happened to be open first.
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        // Load Kanban columns for the active workspace.
        //
        // This used to read 'kanban_columns', a key with no workspace suffix
        // that nothing has ever written, so it always fell through to the
        // hardcoded ids below ('backlog', 'todo') which exist on no real board.
        //
        // Not cosmetic: a card with status 'open' matched no <option>, so the
        // select showed "Backlog" whatever the real status, and picking one
        // wrote a status no column owns, dropping the card off the board.
        const { columns: boardColumns } = await loadBoardConfig(activeWorkspace)
        setColumns(boardColumns.map(c => ({ id: c.id, name: c.name })))

        // Load all tags
        const tags = await window.electronAPI.db.getTags()
        setAllTags(tags)
      } catch (err) {
        console.error('Failed to load item detail metadata:', err)
      }
    }
    fetchMetadata()
  }, [activeWorkspace])

  // 3. Load item details
  useEffect(() => {
    if (!selectedItemId) {
      setItem(null)
      return
    }

    const loadItemDetails = async () => {
      setLoading(true)
      setIsEditingBody(false)
      try {
        const res = await window.electronAPI.db.searchItems({
          query: selectedItemId,
          context: activeWorkspace
        })
        const found = res.items.find(i => i.id === selectedItemId)
        if (found) {
          setItem(found)
          setTitle(found.title)
          setBody(found.body)
          setStatus(found.status)
          setPriority(found.priority)
          
          if (found.due_at) {
            const d = new Date(found.due_at)
            const yyyy = d.getFullYear()
            const mm = String(d.getMonth() + 1).padStart(2, '0')
            const dd = String(d.getDate()).padStart(2, '0')
            setDueDate(`${yyyy}-${mm}-${dd}`)
          } else {
            setDueDate('')
          }

          setSelectedTagIds(found.tags?.map(t => t.id) ?? [])
        } else {
          setItem(null)
        }
      } catch (err) {
        console.error('Failed to load item detail drawer details:', err)
        setItem(null)
      } finally {
        setLoading(false)
      }
    }
    loadItemDetails()
  }, [selectedItemId, activeWorkspace])

  if (!selectedItemId) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)', padding: 'var(--space-6)', textAlign: 'center' }}>
        <FileText size={40} style={{ marginBottom: 'var(--space-3)' }} />
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>No Item Selected</span>
        <span style={{ fontSize: 'var(--text-2xs)', marginTop: 'var(--space-1)', maxWidth: '200px', lineHeight: 1.4 }}>Click on any task or kanban card to view and edit details.</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ flex: 1, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Skeleton height="32px" width="80%" />
        <Skeleton height="20px" width="40%" />
        <Skeleton height="120px" />
        <Skeleton height="20px" width="60%" />
      </div>
    )
  }

  if (!item) {
    return (
      <div style={{ flex: 1, padding: 'var(--space-4)', color: 'var(--color-error)' }}>
        <AlertCircle size={20} style={{ marginBottom: 'var(--space-2)' }} />
        <span>Failed to load item details. It may have been deleted.</span>
      </div>
    )
  }

  const handleUpdateField = async (patch: Partial<Item>, updatedTagIds?: string[]) => {
    try {
      const tagsToSave = updatedTagIds ?? selectedTagIds
      await window.electronAPI.db.updateItem(item.id, patch, tagsToSave)
      
      // Update local state
      setItem(prev => prev ? { ...prev, ...patch, tags: allTags.filter(t => tagsToSave.includes(t.id)) } : null)

      // Notify parent views to refresh immediately
      window.dispatchEvent(new CustomEvent('item-updated', { detail: { id: item.id, patch } }))
    } catch (err) {
      console.error('Failed to update field:', err)
      toast('Failed to save changes')
    }
  }

  const handleToggleTag = (tagId: string) => {
    const alreadySelected = selectedTagIds.includes(tagId)
    const nextSelected = alreadySelected
      ? selectedTagIds.filter(id => id !== tagId)
      : [...selectedTagIds, tagId]
    
    setSelectedTagIds(nextSelected)
    handleUpdateField({}, nextSelected)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Scrollable details container */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        
        {/* Title Input */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            {item.type === 'task' ? (
              <CheckSquare size={12} style={{ color: 'var(--color-secondary)' }} />
            ) : (
              <Layout size={12} style={{ color: 'var(--color-primary)' }} />
            )}
            <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-faint)', fontWeight: 'var(--weight-bold)' }}>
              {item.type}
            </span>
          </div>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title.trim() !== item.title) {
                handleUpdateField({ title: title.trim() })
              } else {
                setTitle(item.title)
              }
            }}
            style={{
              width: '100%',
              background: 'transparent',
              border: '1px solid transparent',
              color: 'var(--color-text-base)',
              fontSize: 'var(--text-md)',
              fontWeight: 'var(--weight-semibold)',
              padding: '2px 4px',
              margin: '0 -4px',
              borderRadius: 'var(--radius-sm)',
              outline: 'none'
            }}
            onFocus={e => (e.currentTarget.style.border = '1px solid var(--color-surface-offset)')}
            onBlurCapture={e => (e.currentTarget.style.border = '1px solid transparent')}
            placeholder="Item title..."
          />
        </div>

        {/* Fields list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', background: 'var(--color-surface-1)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', border: '1px solid var(--color-surface-offset)' }}>
          
          {/* Status field */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={12} /> Status
            </span>
            <select
              value={status}
              onChange={e => {
                setStatus(e.target.value)
                handleUpdateField({ status: e.target.value })
              }}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {columns.map(col => (
                <option key={col.id} value={col.id}>{col.name}</option>
              ))}
            </select>
          </div>

          {/* Priority field */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={12} /> Priority
            </span>
            <select
              value={priority}
              onChange={e => {
                const val = Number(e.target.value) as 0 | 1 | 2 | 3
                setPriority(val)
                handleUpdateField({ priority: val })
              }}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: priority === 3 ? 'var(--color-error)' : priority === 2 ? 'var(--color-priority-med)' : priority === 1 ? 'var(--color-priority-low)' : 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
                outline: 'none',
                fontWeight: priority > 0 ? 'var(--weight-semibold)' : 'var(--weight-normal)'
              }}
            >
              <option value={0}>None</option>
              <option value={1}>Low</option>
              <option value={2}>Medium</option>
              <option value={3}>High</option>
            </select>
          </div>

          {/* Due date field */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Calendar size={12} /> Due Date
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={e => {
                setDueDate(e.target.value)
                if (e.target.value) {
                  const ms = new Date(e.target.value).getTime()
                  handleUpdateField({ due_at: ms })
                } else {
                  handleUpdateField({ due_at: null })
                }
              }}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                fontSize: 'var(--text-xs)',
                outline: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)'
              }}
            />
          </div>
        </div>

        {/* Tags Section */}
        <div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-faint)', fontWeight: 'var(--weight-bold)', display: 'block', marginBottom: 'var(--space-2)' }}>
            Tags
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
            {item.tags?.map(t => (
              <span
                key={t.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: `${t.color}20`,
                  border: `1px solid ${t.color}40`,
                  color: t.color,
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px 6px',
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 'var(--weight-semibold)'
                }}
              >
                {t.name}
              </span>
            ))}
            
            {/* Tag Selector dropdown */}
            <div style={{ position: 'relative' }} ref={tagSelectorRef}>
              <button
                type="button"
                onClick={() => setShowTagSelector(!showTagSelector)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'var(--color-surface-2)',
                  border: '1px dashed var(--color-balance)',
                  color: 'var(--color-text-muted)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px 6px',
                  fontSize: 'var(--text-2xs)',
                  cursor: 'pointer'
                }}
              >
                <TagIcon size={10} /> Edit Tags <ChevronDown size={10} />
              </button>

              {showTagSelector && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  zIndex: 200,
                  marginTop: '4px',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  width: '220px',
                  boxShadow: 'var(--shadow-md)',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  padding: '6px'
                }}>
                  {allTags.map(tag => {
                    const isSel = selectedTagIds.includes(tag.id)
                    return (
                      <div
                        key={tag.id}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '4px 6px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '11px',
                          gap: '6px'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <button
                          type="button"
                          onClick={() => handleToggleTag(tag.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--color-text-base)',
                            padding: 0,
                            fontSize: '11px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            flex: 1
                          }}
                        >
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag.name}</span>
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <ColorPicker
                            value={tag.color}
                            showHexInput={false}
                            swatchSize={14}
                            title="Edit Tag Color"
                            onCommit={async (newColor) => {
                              try {
                                await window.electronAPI.db.updateTag(tag.id, { color: newColor })
                                const refreshed = await window.electronAPI.db.getTags()
                                setAllTags(refreshed)
                              } catch (err) {
                                console.error(err)
                              }
                            }}
                          />
                          {isSel && <Check size={12} style={{ color: 'var(--color-secondary)' }} />}
                        </div>
                      </div>
                    )
                  })}
                  {allTags.length === 0 && (
                    <div style={{ padding: '8px', fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center' }}>
                      No tags configured
                    </div>
                  )}
                  
                  {/* Create custom label inline manager */}
                  <div style={{ borderTop: '1px solid var(--color-surface-offset)', marginTop: '8px', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>
                      Create Label
                    </span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <input
                        type="text"
                        placeholder="Label name..."
                        id="panel-new-tag-name"
                        style={{
                          flex: 1,
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: '4px',
                          color: 'var(--color-text-base)',
                          fontSize: '11px',
                          padding: '3px 6px',
                          outline: 'none',
                          minWidth: 0
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            document.getElementById('panel-new-tag-create-btn')?.click()
                          }
                        }}
                      />
                      <button
                        id="panel-new-tag-create-btn"
                        type="button"
                        onClick={async () => {
                          const el = document.getElementById('panel-new-tag-name') as HTMLInputElement
                          if (el && el.value.trim()) {
                            const name = el.value.trim()
                            try {
                              const created = await window.electronAPI.db.createTag({ name, color: selectedTagColor })
                              const tags = await window.electronAPI.db.getTags()
                              setAllTags(tags)
                              handleToggleTag(created.id)
                              el.value = ''
                            } catch (err) {
                              console.error(err)
                            }
                          }
                        }}
                        style={{
                          background: 'var(--color-secondary)',
                          border: 'none',
                          borderRadius: '4px',
                          color: 'var(--color-text-inverted)',
                          fontWeight: 'var(--weight-bold)',
                          fontSize: '10px',
                          padding: '3px 8px',
                          cursor: 'pointer',
                          flexShrink: 0
                        }}
                      >
                        Create
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#cdf12b', '#ff45b5'].map(color => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setSelectedTagColor(color)}
                            style={{
                              width: '14px',
                              height: '14px',
                              borderRadius: '50%',
                              background: color,
                              border: selectedTagColor === color ? '1px solid var(--color-text-base)' : '1px solid transparent',
                              cursor: 'pointer',
                              padding: 0
                            }}
                          />
                        ))}
                      </div>
                      <ColorPicker
                        value={selectedTagColor}
                        onCommit={setSelectedTagColor}
                        swatchSize={18}
                        hexInputWidth={54}
                        title="Custom Tag Color"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Description Section */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-faint)', fontWeight: 'var(--weight-bold)' }}>
              Description
            </span>
            <button
              onClick={() => {
                if (isEditingBody) {
                  handleUpdateField({ body })
                }
                setIsEditingBody(!isEditingBody)
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-primary)',
                fontSize: '10px',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {isEditingBody ? (
                <>
                  <Check size={10} /> Preview
                </>
              ) : (
                <>
                  <Edit2 size={10} /> Edit
                </>
              )}
            </button>
          </div>

          <div style={{ flex: 1, minHeight: '160px', display: 'flex', flexDirection: 'column' }}>
            {isEditingBody ? (
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                onBlur={() => {
                  handleUpdateField({ body })
                }}
                placeholder="Add markdown description..."
                style={{
                  flex: 1,
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-sans)',
                  resize: 'none',
                  outline: 'none',
                  lineHeight: 1.5
                }}
              />
            ) : (
              <div
                onClick={() => setIsEditingBody(true)}
                style={{
                  flex: 1,
                  background: 'var(--color-surface-1)',
                  border: '1px dashed var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  color: body ? 'var(--color-text-base)' : 'var(--color-text-faint)',
                  cursor: 'pointer',
                  overflowY: 'auto',
                  lineHeight: 1.5
                }}
              >
                {body ? (
                  <div className="markdown-body" onClick={e => e.stopPropagation()}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      urlTransform={url => url}
                    >
                      {body}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <span>Click to add description...</span>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
