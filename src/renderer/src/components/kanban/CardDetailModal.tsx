import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CustomCodeBlock } from '../log/LogEntry'
import { X, Tag, Link2, Sparkles, Check } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Item, Tag as TagType, Relation, RelationType } from '../../../../shared/types'

interface CardDetailModalProps {
  cardId: string
  columns: Array<{ id: string; name: string }>
  onClose: () => void
  onUpdate: (id: string, patch: Partial<Item>, tagIds?: string[]) => Promise<void>
}

type EditorMode = 'edit' | 'preview' | 'split'

export default function CardDetailModal({ cardId, columns, onClose, onUpdate }: CardDetailModalProps) {
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

  const titleInputRef = useRef<HTMLInputElement>(null)

  // Load card details, tags, relations
  useEffect(() => {
    let active = true
    const loadDetails = async () => {
      setLoading(true)
      try {
        const itemsResult = await window.electronAPI.db.searchItems({
          query: cardId,
          context: activeContext,
          type: 'card'
        })
        const found = itemsResult.items.find(i => i.id === cardId)
        if (!found) {
          onClose()
          return
        }
        
        if (active) {
          setCard(found)
          setTitle(found.title)
          setBody(found.body)
          setSelectedTagIds(found.tags?.map(t => t.id) || [])
          
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
  }, [cardId, activeContext, onClose])

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
        top: 0,
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
      top: 0,
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
      >
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              onClick={handleAiAssist}
              style={{
                background: 'var(--color-secondary-muted)',
                border: '1px solid var(--color-secondary)',
                color: 'var(--color-secondary)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-1.5) var(--space-3)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1.5)'
              }}
              onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
              onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
            >
              <Sparkles size={12} fill="currentColor" />
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
          gap: 'var(--space-6)'
        }}>
          {/* Card Title Editable */}
          <div>
            <input
              ref={titleInputRef}
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
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
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
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
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

            {/* Due Date Picker */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Due Date
              </span>
              <input
                type="date"
                value={card.due_at ? new Date(card.due_at).toISOString().substring(0, 10) : ''}
                onChange={handleDueDateChange}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  outline: 'none'
                }}
              />
            </div>

            {/* Tag Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)', position: 'relative' }}>
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Tags
              </span>
              <button
                type="button"
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
                  maxHeight: '180px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}>
                  {allTags.map(tag => {
                    const isSelected = selectedTagIds.includes(tag.id)
                    return (
                      <button
                        key={tag.id}
                        onClick={() => handleTagToggle(tag.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--color-text-base)',
                          padding: 'var(--space-1.5) var(--space-2)',
                          fontSize: 'var(--text-xs)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          borderRadius: 'var(--radius-sm)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: tag.color }} />
                          {tag.name}
                        </span>
                        {isSelected && <Check size={12} style={{ color: 'var(--color-secondary)' }} />}
                      </button>
                    )
                  })}
                  {allTags.length === 0 && (
                    <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', padding: 'var(--space-2)' }}>
                      No tags available. Create tags in Log view first.
                    </span>
                  )}
                </div>
              )}
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
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
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

          {/* Relations Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Linked Relations
            </span>

            {/* Relations list */}
            {relations.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
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
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
        </div>
      </div>

      {/* Slide-in Drawer animation */}
      <style>{`
        @keyframes slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
