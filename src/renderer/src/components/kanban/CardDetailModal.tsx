import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CustomCodeBlock } from '../log/LogEntry'
import { X, Tag, Link2, Sparkles, Check, CheckSquare, Trash2, FilePlus, Paperclip, Clock, Layers } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Item, Tag as TagType, Relation, RelationType } from '../../../../shared/types'
import useEscapeKey from '../ui/useEscapeKey'
import useFocusTrap from '../ui/useFocusTrap'
import ColorPicker from '../ui/ColorPicker'
import { handleImagePaste, handleImageDrop } from '../../lib/mediaHelper'
import RewindPanel from './RewindPanel'

interface CardDetailModalProps {
  cardId: string
  initialCard?: Item
  columns: Array<{ id: string; name: string }>
  onClose: () => void
  onUpdate: (id: string, patch: Partial<Item>, tagIds?: string[]) => Promise<void>
  isReadOnly?: boolean
}

type EditorMode = 'edit' | 'preview' | 'split'

export default function CardDetailModal({ cardId, initialCard, columns, onClose, onUpdate, isReadOnly = false }: CardDetailModalProps) {
  const selectItem = useAppStore(s => s.selectItem)
  const toggleRightPanel = useAppStore(s => s.toggleRightPanel)
  const activeContext = useAppStore(s => s.activeContext)

  const [card, setCard] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  
  // Editor mode: edit, preview, split
  const [editorMode, setEditorMode] = useState<EditorMode>('split')

  // Tags
  const [allTags, setAllTags] = useState<TagType[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [showTagSelector, setShowTagSelector] = useState(false)

  // Relations
  const [relations, setRelations] = useState<Relation[]>([])
  const [relationSearchQuery, setRelationSearchQuery] = useState('')
  const [relationSearchResults, setRelationSearchResults] = useState<Item[]>([])
  const [selectedRelationType, setSelectedRelationType] = useState<RelationType>('relates_to')

  // Trello Meta States
  const [cover, setCover] = useState<{ type: 'color' | 'image'; value: string; size?: 'header' | 'full' } | null>(null)
  const [liveCoverColor, setLiveCoverColor] = useState<string | null>(null)
  const [checklist, setChecklist] = useState<Array<{ id: string; text: string; done: boolean }>>([])
  const [comments, setComments] = useState<Array<{ id: string; user: string; text: string; createdAt: number }>>([])
  const [activities, setActivities] = useState<Array<{ id: string; text: string; createdAt: number }>>([])
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; path: string; isImage: boolean; createdAt: number }>>([])
  const [isTemplate, setIsTemplate] = useState(false)
  const [dueDateCompleted, setDueDateCompleted] = useState(false)
  
  // Form inputs
  const [selectedTagColor, setSelectedTagColor] = useState('#3b82f6')
  const [commentInput, setCommentInput] = useState('')
  const [newChecklistText, setNewChecklistText] = useState('')
  const [newLinkName, setNewLinkName] = useState('')
  const [newLinkUrl, setNewLinkUrl] = useState('')

  const titleInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useFocusTrap(!loading, titleInputRef)
  useEscapeKey(onClose, true)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const initialCardRef = useRef(initialCard)
  useEffect(() => {
    initialCardRef.current = initialCard
  }, [initialCard])

  // Load card details, tags, relations
  useEffect(() => {
    let active = true
    const loadDetails = async () => {
      setLoading(true)
      try {
        let found: Item | null = initialCardRef.current || null
        if (!found) {
          const res = await window.electronAPI.db.getItems(activeContext, 'card', 1, 1000)
          found = res.items.find(i => i.id === cardId) || null
        }
        if (!found) {
          onCloseRef.current()
          return
        }
        
        if (active) {
          setCard(found)
          setTitle(found.title)
          setBody(found.body)
          setSelectedTagIds(found.tags?.map(t => t.id) || [])
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let meta: any = {}
          try {
            meta = JSON.parse(found.metadata || '{}')
          } catch {}
          
          setCover(meta.cover || null)
          setChecklist(meta.checklist || [])
          setComments(meta.comments || [])
          setActivities(meta.activities || [])
          setAttachments(meta.attachments || [])
          setIsTemplate(meta.isTemplate === true)
          setDueDateCompleted(meta.dueDateCompleted === true)
          
          const tags = await window.electronAPI.db.getTags()
          setAllTags(tags)

          const rels = await window.electronAPI.db.getRelations(cardId)
          setRelations(rels)
        }
      } catch (err) {
        console.error('Failed to load card details:', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    loadDetails()
    return () => { active = false }
  }, [cardId, activeContext])

  // Search for relations
  useEffect(() => {
    if (!relationSearchQuery.trim()) {
      setRelationSearchResults([])
      return
    }

    const delayDebounceFn = setTimeout(async () => {
      try {
        const res = await window.electronAPI.db.searchItems({
          query: relationSearchQuery,
          context: activeContext
        })
        // Filter out current card itself
        setRelationSearchResults(res.items.filter(i => i.id !== cardId))
      } catch (err) {
        console.error('Failed to search items for relations:', err)
      }
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [relationSearchQuery, cardId, activeContext])

  const handleTitleBlur = () => {
    if (!card || !title.trim() || title === card.title) return
    onUpdate(card.id, { title: title.trim() })
  }

  const handleBodyBlur = () => {
    if (!card || body === card.body) return
    onUpdate(card.id, { body })
    // Sync local state so subsequent blurs don't re-fire with no changes
    setCard(prev => prev ? { ...prev, body } : null)
  }

  // Track latest metadata synchronously in memory to avoid race conditions with sequential updates
  const latestMetaRef = useRef<Record<string, unknown>>({})
  useEffect(() => {
    if (card?.metadata) {
      try {
        latestMetaRef.current = JSON.parse(card.metadata)
      } catch {}
    }
  }, [card?.metadata])

  // Meta Updates helpers
  const updateMetadata = async (newMetaPatch: Record<string, unknown>) => {
    if (!card) return
    const mergedMeta = { ...latestMetaRef.current, ...newMetaPatch }
    latestMetaRef.current = mergedMeta
    const serialized = JSON.stringify(mergedMeta)
    
    setCard(prev => prev ? { ...prev, metadata: serialized } : null)
    await onUpdate(card.id, { metadata: serialized })
  }

  const addActivity = (text: string) => {
    const newAct = { id: `act-${Date.now()}`, text, createdAt: Date.now() }
    const updated = [newAct, ...activities]
    setActivities(updated)
    updateMetadata({ activities: updated })
  }

  // Checklist helpers
  const handleAddChecklistItem = (text: string) => {
    if (!text.trim()) return
    const newItem = { id: `chk-${Date.now()}`, text: text.trim(), done: false }
    const updated = [...checklist, newItem]
    setChecklist(updated)
    updateMetadata({ checklist: updated })
    addActivity(`Added checklist item "${text.trim()}"`)
  }

  const handleToggleChecklistItem = (itemId: string) => {
    const updated = checklist.map(item => {
      if (item.id === itemId) {
        const nextState = !item.done
        addActivity(`${nextState ? 'Completed' : 'Uncompleted'} checklist item "${item.text}"`)
        return { ...item, done: nextState }
      }
      return item
    })
    setChecklist(updated)
    updateMetadata({ checklist: updated })
  }

  const handleDeleteChecklistItem = (itemId: string) => {
    const target = checklist.find(item => item.id === itemId)
    const updated = checklist.filter(item => item.id !== itemId)
    setChecklist(updated)
    updateMetadata({ checklist: updated })
    if (target) {
      addActivity(`Deleted checklist item "${target.text}"`)
    }
  }

  // Comments helpers
  const handlePostComment = () => {
    if (!commentInput.trim()) return
    const newComment = {
      id: `com-${Date.now()}`,
      user: 'Developer',
      text: commentInput.trim(),
      createdAt: Date.now()
    }
    const updated = [newComment, ...comments]
    setComments(updated)
    updateMetadata({ comments: updated })
    setCommentInput('')
    addActivity(`Added a comment`)
  }

  const handleDeleteComment = (commentId: string) => {
    const updated = comments.filter(c => c.id !== commentId)
    setComments(updated)
    updateMetadata({ comments: updated })
    addActivity(`Deleted a comment`)
  }

  // Attachments helpers
  const handleAddLinkAttachment = (name: string, url: string) => {
    if (!url.trim()) return
    const newAttachment = {
      id: `att-${Date.now()}`,
      name: name.trim() || url.trim(),
      path: url.trim(),
      isImage: false,
      createdAt: Date.now()
    }
    const updated = [...attachments, newAttachment]
    setAttachments(updated)
    updateMetadata({ attachments: updated })
    addActivity(`Attached link: "${url.trim()}"`)
  }

  const handleAddFileAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      const name = file.name
      // Electron ≥32: File.path no longer exists, resolve via preload webUtils
      const path = window.electronAPI.app.getPathForFile(file)
      const isImage = file.type.startsWith('image/')
      
      const newAttachment = {
        id: `att-${Date.now()}`,
        name,
        path,
        isImage,
        createdAt: Date.now()
      }
      const updated = [...attachments, newAttachment]
      setAttachments(updated)
      updateMetadata({ attachments: updated })
      addActivity(`Attached file: "${name}"`)
    }
  }

  const handleSetCoverImage = (urlOrPath: string) => {
    setCover({ type: 'image', value: urlOrPath })
    updateMetadata({ cover: { type: 'image', value: urlOrPath } })
    addActivity(`Set card cover image`)
  }

  const handlePriorityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!card) return
    const priority = parseInt(e.target.value) as Item['priority']
    onUpdate(card.id, { priority })
    setCard(prev => prev ? { ...prev, priority } : null)
  }

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!card) return
    const status = e.target.value
    onUpdate(card.id, { status })
    setCard(prev => prev ? { ...prev, status } : null)
  }

  const handleDueDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!card) return
    const dateVal = e.target.value
    const due_at = dateVal ? new Date(dateVal).getTime() : null
    onUpdate(card.id, { due_at })
    setCard(prev => prev ? { ...prev, due_at } : null)
  }

  const handleTagToggle = async (tagId: string) => {
    if (!card) return
    let updatedTags: string[]
    if (selectedTagIds.includes(tagId)) {
      updatedTags = selectedTagIds.filter(id => id !== tagId)
    } else {
      updatedTags = [...selectedTagIds, tagId]
    }
    
    setSelectedTagIds(updatedTags)
    await onUpdate(card.id, {}, updatedTags)
    
    // Refresh card tags locally
    const refreshedTags = allTags.filter(t => updatedTags.includes(t.id))
    setCard(prev => prev ? { ...prev, tags: refreshedTags } : null)
  }

  const handleAddRelation = async (targetId: string) => {
    if (!card) return
    try {
      await window.electronAPI.db.createRelation(card.id, targetId, selectedRelationType)
      const rels = await window.electronAPI.db.getRelations(card.id)
      setRelations(rels)
      setRelationSearchQuery('')
      setRelationSearchResults([])
    } catch (err) {
      console.error('Failed to create relation:', err)
    }
  }

  const handleDeleteRelation = async (relationId: string) => {
    try {
      await window.electronAPI.db.deleteRelation(relationId)
      setRelations(prev => prev.filter(r => r.id !== relationId))
    } catch (err) {
      console.error('Failed to delete relation:', err)
    }
  }

  const handleAiAssist = () => {
    if (!card) return
    // Pre-seed context for AI Chat in right panel
    selectItem(card.id)
    toggleRightPanel('ai-chat')
  }

  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        top: '32px',
        right: 0,
        bottom: 0,
        width: '600px',
        background: 'var(--color-surface-1)',
        borderLeft: '1px solid var(--color-surface-offset)',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-muted)'
      }}>
        Loading details...
      </div>
    )
  }

  if (!card) return null

  return (
    <div style={{
      position: 'fixed',
      top: '32px',
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 900,
      display: 'flex',
      justifyContent: 'flex-end',
      backdropFilter: 'blur(2px)'
    }}
    onClick={onClose}
    >
      <div
        ref={containerRef}
        style={{
          width: '650px',
          height: '100%',
          background: 'var(--color-surface-1)',
          borderLeft: '1px solid var(--color-surface-offset)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
          animation: 'slide-in 0.25s cubic-bezier(0.32, 0.72, 0, 1)'
        }}
        onClick={e => e.stopPropagation()} // Prevent closing on drawer click
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-modal-title"
      >
        {/* Card Cover Header Banner */}
        <div
          id="card-modal-cover-banner"
          style={{
            height: (liveCoverColor || cover?.type === 'color') ? '48px' : (cover?.type === 'image' ? '110px' : '0px'),
            backgroundColor: liveCoverColor || (cover?.type === 'color' ? cover.value : 'transparent'),
            backgroundImage: !liveCoverColor && cover?.type === 'image' ? `url(${cover.value})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            width: '100%',
            flexShrink: 0,
            transition: 'height 0.2s ease, background-color 0.15s ease'
          }}
        />
        {/* Drawer Header */}
        <div style={{
          height: '56px',
          padding: '0 var(--space-6)',
          borderBottom: '1px solid var(--color-surface-offset)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div className="row">
            <span style={{
              fontSize: '10px',
              fontWeight: 'var(--weight-bold)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              padding: '2px 6px',
              borderRadius: '4px'
            }}>
              CARD #{card.id.substring(0, 8)}
            </span>
          </div>

          <div className="row">
            <button
              onClick={handleAiAssist}
              style={{
                background: 'var(--color-secondary-muted)',
                border: '1.5px solid var(--color-secondary)',
                color: 'var(--color-secondary)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 14px',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-bold)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.filter = 'brightness(1.2)'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.filter = 'none'
                e.currentTarget.style.transform = 'none'
              }}
            >
              <Sparkles size={16} fill="currentColor" />
              <span>AI Assist</span>
            </button>

            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex'
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Drawer Body Scroll Container */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-6)',
          pointerEvents: isReadOnly ? 'none' : 'auto',
          opacity: isReadOnly ? 0.95 : 1
        }}>
          {isReadOnly && (
            <div style={{
              background: 'var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px dashed var(--color-surface-offset)',
              marginBottom: '2px',
              userSelect: 'none'
            }}>
              <span>👁️</span>
              <span>You are viewing a shared board in spectate mode. Changes cannot be made.</span>
            </div>
          )}
          {/* Card Title Editable */}
          <div>
            <input
              ref={titleInputRef}
              id="card-modal-title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Enter card title..."
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid transparent',
                fontSize: 'var(--text-xl)',
                fontWeight: 'var(--weight-bold)',
                color: 'var(--color-text-base)',
                outline: 'none',
                padding: '4px 0',
                transition: 'border-color var(--duration-fast)'
              }}
              onFocus={e => (e.target.style.borderBottomColor = 'var(--color-surface-offset)')}
              onBlurCapture={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
            />
          </div>

          {/* Quick Properties Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'var(--space-4)',
            padding: 'var(--space-4)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-surface-offset)'
          }}>
            {/* Status (Column) Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span className="label-caps">
                Status
              </span>
              <select
                value={card.status}
                onChange={handleStatusChange}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  outline: 'none'
                }}
              >
                {columns.map(col => (
                  <option key={col.id} value={col.id}>{col.name}</option>
                ))}
              </select>
            </div>

            {/* Priority Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span className="label-caps">
                Priority
              </span>
              <select
                value={card.priority}
                onChange={handlePriorityChange}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  outline: 'none'
                }}
              >
                <option value={0}>None</option>
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </select>
            </div>

            {/* Due Date Picker & Done Checkbox */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span className="label-caps">
                Due Date
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="date"
                  value={card.due_at ? new Date(card.due_at).toISOString().substring(0, 10) : ''}
                  onChange={handleDueDateChange}
                  style={{
                    flex: 1,
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: 'var(--text-sm)',
                    outline: 'none'
                  }}
                />
                {card.due_at && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={dueDateCompleted}
                      onChange={async (e) => {
                        const val = e.target.checked
                        setDueDateCompleted(val)
                        updateMetadata({ dueDateCompleted: val })
                        addActivity(`Marked due date as ${val ? 'completed' : 'incomplete'}`)
                      }}
                    />
                    <span>Done</span>
                  </label>
                )}
              </div>
            </div>

            {/* Tag Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)', position: 'relative' }}>
              <span className="label-caps">
                Tags
              </span>
              <button
                type="button"
                aria-expanded={showTagSelector}
                aria-haspopup="menu"
                onClick={() => setShowTagSelector(!showTagSelector)}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>{selectedTagIds.length ? `${selectedTagIds.length} Tags selected` : 'Select tags...'}</span>
                <Tag size={14} />
              </button>

              {/* Tags Dropdown Popover */}
              {showTagSelector && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '4px',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)',
                  padding: 'var(--space-2)',
                  zIndex: 200,
                  maxHeight: '320px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}>
                  {allTags.map(tag => {
                    const isSelected = selectedTagIds.includes(tag.id)
                    return (
                      <div
                        key={tag.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--space-1) var(--space-2)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-xs)',
                          gap: '6px'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <button
                          onClick={() => handleTagToggle(tag.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--color-text-base)',
                            padding: 0,
                            fontSize: 'var(--text-xs)',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
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
                          {isSelected && <Check size={12} style={{ color: 'var(--color-secondary)' }} />}
                        </div>
                      </div>
                    )
                  })}
                  {allTags.length === 0 && (
                    <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', padding: 'var(--space-2)' }}>
                      No tags available.
                    </span>
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
                        id="new-tag-name"
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
                            document.getElementById('new-tag-create-btn')?.click()
                          }
                        }}
                      />
                      <button
                        id="new-tag-create-btn"
                        onClick={async () => {
                          const el = document.getElementById('new-tag-name') as HTMLInputElement
                          if (el && el.value.trim()) {
                            const name = el.value.trim()
                            try {
                              const created = await window.electronAPI.db.createTag({ name, color: selectedTagColor })
                              const tags = await window.electronAPI.db.getTags()
                              setAllTags(tags)
                              handleTagToggle(created.id)
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

            {/* Cover Color Selector */}
            {/* Cover Color & Display Mode Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span className="label-caps">
                Cover Color & Mode
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Mode Selector (Header Strip vs Full Background) */}
                {cover && cover.type === 'color' && (
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '2px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const nextCover = { ...cover, size: 'header' as const }
                        setCover(nextCover)
                        updateMetadata({ cover: nextCover })
                      }}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        background: (cover.size !== 'full') ? 'var(--color-primary)' : 'var(--color-surface-1)',
                        color: (cover.size !== 'full') ? '#ffffff' : 'var(--color-text-muted)',
                        border: '1px solid var(--color-surface-offset)'
                      }}
                    >
                      <div style={{ width: '12px', height: '10px', borderRadius: '2px', border: '1px solid currentColor', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ height: '4px', background: 'currentColor' }} />
                      </div>
                      <span>Header</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextCover = { ...cover, size: 'full' as const }
                        setCover(nextCover)
                        updateMetadata({ cover: nextCover })
                      }}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        background: (cover.size === 'full') ? 'var(--color-primary)' : 'var(--color-surface-1)',
                        color: (cover.size === 'full') ? '#ffffff' : 'var(--color-text-muted)',
                        border: '1px solid var(--color-surface-offset)'
                      }}
                    >
                      <div style={{ width: '12px', height: '10px', borderRadius: '2px', background: 'currentColor' }} />
                      <span>Full Card</span>
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', height: '100%', minHeight: '36px' }}>
                  {['none', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#a855f7', '#ec4899'].map(color => {
                    const isSelected = color === 'none' ? !cover : (cover?.type === 'color' && cover.value === color)
                    return (
                      <button
                        key={color}
                        onClick={() => {
                          setLiveCoverColor(null)
                          if (color === 'none') {
                            setCover(null)
                            updateMetadata({ cover: null })
                            addActivity(`Removed card cover`)
                          } else {
                            const size = cover?.size || 'header'
                            const nextCover = { type: 'color' as const, value: color, size }
                            setCover(nextCover)
                            updateMetadata({ cover: nextCover })
                            addActivity(`Set card cover color to ${color}`)
                          }
                        }}
                        style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '4px',
                          background: color === 'none' ? 'transparent' : color,
                          border: isSelected 
                            ? '2px solid var(--color-text-base)' 
                            : (color === 'none' ? '1px dashed var(--color-text-muted)' : '1px solid transparent'),
                          cursor: 'pointer',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--color-text-base)',
                          fontSize: '9px'
                        }}
                        title={color === 'none' ? 'No Cover' : color}
                      >
                        {color === 'none' && '×'}
                      </button>
                    )
                  })}
                  <ColorPicker
                    value={cover?.type === 'color' ? cover.value : ''}
                    onLiveDomUpdate={col => {
                      const banner = document.getElementById('card-modal-cover-banner')
                      if (banner) banner.style.backgroundColor = col
                    }}
                    onCommit={col => {
                      if (col) {
                        const size = cover?.size || 'header'
                        const nextCover = { type: 'color' as const, value: col, size }
                        setCover(nextCover)
                        updateMetadata({ cover: nextCover })
                        addActivity(`Set card cover color to ${col}`)
                      } else {
                        setCover(null)
                        updateMetadata({ cover: null })
                      }
                    }}
                    swatchSize={20}
                    hexInputWidth={58}
                    title="Custom Cover Hexcode"
                  />
                </div>
              </div>
            </div>

            {/* Template Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span className="label-caps">
                Is Template?
              </span>
              <div style={{ display: 'flex', alignItems: 'center', height: '100%', minHeight: '36px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', color: 'var(--color-text-base)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isTemplate}
                    onChange={async (e) => {
                      const val = e.target.checked
                      setIsTemplate(val)
                      updateMetadata({ isTemplate: val })
                      addActivity(`Marked card as ${val ? 'template' : 'regular card'}`)
                    }}
                  />
                  <span>Mark as Template</span>
                </label>
              </div>
            </div>
          </div>


          {/* Description / Custom Split Markdown Editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1, minHeight: '300px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--color-surface-offset)',
              paddingBottom: 'var(--space-2)'
            }}>
              <span className="label-caps">
                Description (Markdown)
              </span>
              
              {/* Layout Toggle */}
              <div style={{
                display: 'flex',
                background: 'var(--color-surface-2)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px',
                border: '1px solid var(--color-surface-offset)'
              }}>
                {(['edit', 'preview', 'split'] as EditorMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setEditorMode(mode)}
                    style={{
                      background: editorMode === mode ? 'var(--color-surface-offset)' : 'transparent',
                      border: 'none',
                      color: editorMode === mode ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      padding: '2px 8px',
                      borderRadius: '2px',
                      cursor: 'pointer',
                      fontWeight: 'var(--weight-semibold)'
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Editor Panes */}
            <div style={{ display: 'flex', flex: 1, gap: 'var(--space-4)', minHeight: '260px' }}>
              {/* Textarea pane */}
              {(editorMode === 'edit' || editorMode === 'split') && (
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onBlur={handleBodyBlur}
                  onPaste={async (e) => {
                    const isImage = await handleImagePaste(e, body, setBody)
                    if (isImage) return
                  }}
                  onDrop={async (e) => {
                    await handleImageDrop(e, body, setBody)
                  }}
                  onDragOver={e => e.preventDefault()}
                  placeholder="Enter details..."
                  style={{
                    flex: 1,
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-4)',
                    color: 'var(--color-text-base)',
                    fontSize: 'var(--text-sm)',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none',
                    resize: 'none',
                    lineHeight: 1.5
                  }}
                  onFocus={e => (e.target.style.borderColor = 'var(--color-primary)')}
                  onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
                />
              )}

              {/* Preview pane */}
              {(editorMode === 'preview' || editorMode === 'split') && (
                <div style={{
                  flex: 1,
                  background: editorMode === 'preview' ? 'transparent' : 'var(--color-surface-2)',
                  border: editorMode === 'preview' ? 'none' : '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  padding: editorMode === 'preview' ? '0' : 'var(--space-4)',
                  overflowY: 'auto',
                  color: 'var(--color-text-base)',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 1.6
                }} className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={url => url}
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '')
                        const isBlock = className?.includes('language-') || String(children).includes('\n')
                        return isBlock ? (
                          <CustomCodeBlock
                            language={match ? match[1] : undefined}
                            value={String(children).replace(/\n$/, '')}
                          />
                        ) : (
                          <code
                            className={className}
                            {...props}
                            style={{
                              background: 'var(--color-surface-1)',
                              padding: '2px 6px',
                              borderRadius: 'var(--radius-sm)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.9em',
                              color: 'var(--color-secondary)'
                            }}
                          >
                            {children}
                          </code>
                        )
                      }
                    }}
                  >
                    {body}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>

          {/* Game Dev Texture Tooling Integration */}
          {(() => {
            const regex = /(?:file:\/\/\/)?([a-zA-Z]:[\\/][^:\r\n"']+\.(?:png|jpg|jpeg|tga|bmp|webp))/gi;
            const paths: string[] = [];
            let match;
            while ((match = regex.exec(body)) !== null) {
              let cleanPath = match[1].replace(/\\/g, '/');
              if (!paths.includes(cleanPath)) {
                paths.push(cleanPath);
              }
            }

            if (paths.length === 0) return null;

            return (
              <div style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)',
                marginTop: 'var(--space-2)'
              }}>
                <div className="row">
                  <Sparkles size={14} style={{ color: 'var(--color-secondary)' }} />
                  <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Game Dev: Texture Tooling Detected
                  </span>
                </div>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
                  This ticket references local texture files. You can generate Normal/Height/Roughness/AO maps, or blend them into seamless tiling textures.
                </p>
                <div className="col">
                  {paths.map((path, idx) => {
                    const fileName = path.split('/').pop() || path;
                    return (
                      <div key={idx} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--color-surface-1)',
                        border: '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2) var(--space-3)',
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1, marginRight: 'var(--space-2)' }}>
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {fileName}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>
                            {path}
                          </span>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                          {/* Generate Maps (PBR) Button */}
                          <button
                            onClick={() => {
                              useAppStore.getState().setGamedevPreloadTexture(path, card.id);
                              useAppStore.getState().setView('gamedev');
                              onClose();
                            }}
                            style={{
                              background: 'var(--color-primary)',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              color: 'white',
                              fontSize: '11px',
                              fontWeight: 'var(--weight-semibold)',
                              padding: '6px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            onMouseOver={e => e.currentTarget.style.background = 'var(--color-primary-hover)'}
                            onMouseOut={e => e.currentTarget.style.background = 'var(--color-primary)'}
                          >
                            <Sparkles size={12} />
                            <span>PBR Maps</span>
                          </button>

                          {/* Make Seamless Button */}
                          <button
                            onClick={() => {
                              useAppStore.getState().setGamedevPreloadSeamless(path, card.id);
                              useAppStore.getState().setView('gamedev');
                              onClose();
                            }}
                            style={{
                              background: 'var(--color-surface-offset)',
                              border: '1px solid var(--color-balance)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--color-text-base)',
                              fontSize: '11px',
                              fontWeight: 'var(--weight-semibold)',
                              padding: '6px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            onMouseOver={e => {
                              e.currentTarget.style.background = 'var(--color-surface-2)'
                              e.currentTarget.style.borderColor = 'var(--color-secondary)'
                            }}
                            onMouseOut={e => {
                              e.currentTarget.style.background = 'var(--color-surface-offset)'
                              e.currentTarget.style.borderColor = 'var(--color-balance)'
                            }}
                          >
                            <Layers size={12} style={{ color: 'var(--color-secondary)' }} />
                            <span>Make Seamless</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Relations Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <span className="label-caps">
              Linked Relations
            </span>

            {/* Relations list */}
            {relations.length > 0 && (
              <div className="col">
                {relations.map(rel => {
                  const isFromCurrent = rel.from_id === cardId
                  const peerId = isFromCurrent ? rel.to_id : rel.from_id
                  // Display relation type
                  const label = rel.type === 'blocks'
                    ? (isFromCurrent ? 'blocks' : 'is blocked by')
                    : rel.type === 'duplicates'
                      ? 'duplicates'
                      : 'relates to'

                  return (
                    <div
                      key={rel.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        padding: 'var(--space-2) var(--space-4)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--text-xs)'
                      }}
                    >
                      <span className="row">
                        <Link2 size={12} style={{ color: 'var(--color-text-muted)' }} />
                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 'var(--weight-semibold)' }}>{label}</span>
                        <span style={{ color: 'var(--color-text-base)' }}>Item #{peerId.substring(0, 8)}</span>
                      </span>

                      <button
                        onClick={() => handleDeleteRelation(rel.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--color-error)',
                          cursor: 'pointer',
                          padding: 0
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Link tool */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', position: 'relative' }}>
              <select
                value={selectedRelationType}
                onChange={e => setSelectedRelationType(e.target.value as RelationType)}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  outline: 'none',
                  flexShrink: 0
                }}
              >
                <option value="relates_to">Relates To</option>
                <option value="blocks">Blocks</option>
                <option value="duplicates">Duplicates</option>
              </select>

              <input
                type="text"
                value={relationSearchQuery}
                onChange={e => setRelationSearchQuery(e.target.value)}
                placeholder="Search card title to link..."
                style={{
                  flex: 1,
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  outline: 'none'
                }}
              />

              {/* Autocomplete Search Results */}
              {relationSearchResults.length > 0 && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  right: 0,
                  marginBottom: '4px',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 -10px 15px -3px rgba(0,0,0,0.3)',
                  maxHeight: '150px',
                  overflowY: 'auto',
                  zIndex: 200,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1px'
                }}>
                  {relationSearchResults.map(res => (
                    <button
                      key={res.id}
                      onClick={() => handleAddRelation(res.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-text-base)',
                        padding: 'var(--space-2)',
                        fontSize: 'var(--text-xs)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <strong style={{ fontSize: '11px' }}>{res.title}</strong>
                      <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>#{res.id.substring(0, 8)} | context: {res.context}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sub-Task Checklist Segment */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
            <div className="row-between">
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckSquare size={13} style={{ color: 'var(--color-secondary)' }} />
                Sub-Task Checklist
              </span>
              {checklist.length > 0 && (
                <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
                  {checklist.filter(c => c.done).length} of {checklist.length} tasks completed
                </span>
              )}
            </div>

            {/* Checklist Progress Bar */}
            {checklist.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ height: '6px', background: 'var(--color-surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${checklist.length > 0 ? Math.round((checklist.filter(i => i.done).length / checklist.length) * 100) : 0}%`, height: '100%', background: 'var(--color-secondary)', borderRadius: '3px', transition: 'width 200ms ease' }} />
                </div>
              </div>
            )}

            {/* Checklist Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {checklist.map(item => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px var(--space-2)',
                    background: 'var(--color-surface-2)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-surface-offset)'
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => handleToggleChecklistItem(item.id)}
                    />
                    <span style={{
                      fontSize: 'var(--text-xs)',
                      color: item.done ? 'var(--color-text-faint)' : 'var(--color-text-base)',
                      textDecoration: item.done ? 'line-through' : 'none',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {item.text}
                    </span>
                  </label>
                  <button
                    onClick={() => handleDeleteChecklistItem(item.id)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', padding: '2px' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-faint)'}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Checklist Item Form */}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                type="text"
                placeholder="Add sub-task..."
                value={newChecklistText}
                onChange={e => setNewChecklistText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddChecklistItem(newChecklistText)
                    setNewChecklistText('')
                  }
                }}
                style={{
                  flex: 1,
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  outline: 'none'
                }}
              />
              <button
                onClick={() => {
                  handleAddChecklistItem(newChecklistText)
                  setNewChecklistText('')
                }}
                style={{
                  background: 'var(--color-surface-offset)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-base)',
                  fontWeight: 'var(--weight-semibold)',
                  fontSize: 'var(--text-xs)',
                  padding: '0 var(--space-4)',
                  cursor: 'pointer'
                }}
              >
                Add Item
              </button>
            </div>
          </div>

          {/* Attachments Segment */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
            <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Paperclip size={13} style={{ color: 'var(--color-secondary)' }} />
              Attachments
            </span>

            {/* List of Attachments */}
            {attachments.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                {attachments.map(att => (
                  <div
                    key={att.id}
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--space-2)'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <span
                        title={att.path}
                        style={{
                          fontSize: '11px',
                          color: 'var(--color-text-base)',
                          fontWeight: 'var(--weight-medium)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer'
                        }}
                        onClick={() => {
                          if (att.path.startsWith('http://') || att.path.startsWith('https://')) {
                            window.open(att.path, '_blank')
                          } else {
                            window.electronAPI.app?.showItemInFolder?.(att.path)
                          }
                        }}
                      >
                        {att.name}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {att.isImage && (
                        <button
                          onClick={() => handleSetCoverImage(att.path)}
                          title="Set as Card Cover"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--color-secondary)',
                            fontSize: '9px',
                            cursor: 'pointer',
                            padding: '2px'
                          }}
                        >
                          Cover
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const updated = attachments.filter(a => a.id !== att.id)
                          setAttachments(updated)
                          updateMetadata({ attachments: updated })
                          addActivity(`Removed attachment "${att.name}"`)
                        }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', padding: '2px' }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Attachment Forms */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '4px', flex: 1, minWidth: '220px' }}>
                <input
                  type="text"
                  placeholder="Link URL..."
                  value={newLinkUrl}
                  onChange={e => setNewLinkUrl(e.target.value)}
                  style={{
                    flex: 2,
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '3px 6px',
                    fontSize: '11px',
                    outline: 'none'
                  }}
                />
                <input
                  type="text"
                  placeholder="Name (optional)..."
                  value={newLinkName}
                  onChange={e => setNewLinkName(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '3px 6px',
                    fontSize: '11px',
                    outline: 'none',
                    minWidth: 0
                  }}
                />
                <button
                  onClick={() => {
                    handleAddLinkAttachment(newLinkName, newLinkUrl)
                    setNewLinkName('')
                    setNewLinkUrl('')
                  }}
                  style={{
                    background: 'var(--color-surface-offset)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-base)',
                    fontSize: '10px',
                    fontWeight: 'var(--weight-semibold)',
                    padding: '3px 8px',
                    cursor: 'pointer'
                  }}
                >
                  Link
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => document.getElementById('card-file-uploader')?.click()}
                  style={{
                    background: 'var(--color-surface-offset)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-base)',
                    fontSize: '10px',
                    fontWeight: 'var(--weight-semibold)',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <FilePlus size={12} />
                  <span>Attach Local File</span>
                </button>
                <input
                  type="file"
                  id="card-file-uploader"
                  style={{ display: 'none' }}
                  onChange={handleAddFileAttachment}
                />
              </div>
            </div>
          </div>

          {/* Rewind, what the user was doing the last time this card was
              worked on. Sits with the historical material rather than above the
              description, which every card has and most cards edit. */}
          {card && (
            <div style={{ borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
              <RewindPanel item={card} />
            </div>
          )}

          {/* Comments & Activity Log Segment (Split layouts) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 'var(--space-5)', borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            
            {/* Comments Thread */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <span className="label-caps">
                Discussion
              </span>

              {/* Post comment input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <textarea
                  placeholder="Write a comment..."
                  value={commentInput}
                  onChange={e => setCommentInput(e.target.value)}
                  onPaste={async (e) => {
                    const isImage = await handleImagePaste(e, commentInput, setCommentInput)
                    if (isImage) return
                  }}
                  onDrop={async (e) => {
                    await handleImageDrop(e, commentInput, setCommentInput)
                  }}
                  onDragOver={e => e.preventDefault()}
                  rows={2}
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2) var(--space-3)',
                    color: 'var(--color-text-base)',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'inherit',
                    outline: 'none',
                    resize: 'none'
                  }}
                />
                <button
                  onClick={handlePostComment}
                  disabled={!commentInput.trim()}
                  style={{
                    alignSelf: 'flex-end',
                    background: 'var(--color-secondary)',
                    border: 'none',
                    color: 'var(--color-text-inverted)',
                    fontWeight: 'var(--weight-bold)',
                    fontSize: '10px',
                    padding: '4px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    opacity: commentInput.trim() ? 1 : 0.5
                  }}
                >
                  Save Comment
                </button>
              </div>

              {/* Comments Feed */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: '200px', overflowY: 'auto' }}>
                {comments.map(c => (
                  <div
                    key={c.id}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-3)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <div className="row-between">
                      <strong style={{ fontSize: '10px', color: 'var(--color-secondary)' }}>{c.user}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '8px', color: 'var(--color-text-faint)' }}>
                          {new Date(c.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                        <button
                          onClick={() => handleDeleteComment(c.id)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', fontSize: '9px', padding: 0 }}
                        >
                          delete
                        </button>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: '11px', color: 'var(--color-text-base)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                      {c.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Audit Activities Trail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderLeft: '1px solid var(--color-surface-offset)', paddingLeft: 'var(--space-4)' }}>
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={11} style={{ color: 'var(--color-text-faint)' }} />
                Activity History
              </span>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto' }}>
                {activities.map(act => (
                  <div key={act.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '4px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.3 }}>{act.text}</span>
                    <span style={{ fontSize: '8px', color: 'var(--color-text-faint)' }}>
                      {new Date(act.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                ))}
                {activities.length === 0 && (
                  <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No activities logged.</span>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>


    </div>
  )
}
