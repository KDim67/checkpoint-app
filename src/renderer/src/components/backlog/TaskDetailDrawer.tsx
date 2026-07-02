import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CustomCodeBlock } from '../log/LogEntry'
import { X, Tag, Link2, Sparkles, Check, CheckSquare, Square, Plus } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Item, Tag as TagType, Relation, RelationType } from '../../../../shared/types'
import useEscapeKey from '../ui/useEscapeKey'
import useFocusTrap from '../ui/useFocusTrap'

interface TaskDetailDrawerProps {
  taskId: string
  columns: Array<{ id: string; name: string }>
  onClose: () => void
  onUpdate: (id: string, patch: Partial<Item>, tagIds?: string[]) => Promise<void>
}

type EditorMode = 'edit' | 'preview' | 'split'

interface SubTask {
  index: number // line index in the markdown text
  checked: boolean
  text: string
}

// Parse checklist items (- [ ] and - [x]) from markdown
function parseSubTasks(markdown: string): SubTask[] {
  const lines = markdown.split('\n')
  const subTasks: SubTask[] = []
  lines.forEach((line, index) => {
    const match = /^\s*-\s*\[([ xX])\]\s*(.*)$/.exec(line)
    if (match) {
      subTasks.push({
        index,
        checked: match[1].toLowerCase() === 'x',
        text: match[2].trim()
      })
    }
  })
  return subTasks
}

// Update checkbox value inside markdown string
function toggleSubTaskMarkdown(markdown: string, lineIndex: number, currentChecked: boolean): string {
  const lines = markdown.split('\n')
  const oldLine = lines[lineIndex]
  const nextChar = currentChecked ? ' ' : 'x'
  lines[lineIndex] = oldLine.replace(/-\s*\[([ xX])\]/, `- [${nextChar}]`)
  return lines.join('\n')
}

// Append a sub-task line to markdown string
function addSubTaskMarkdown(markdown: string, text: string): string {
  const trimmed = markdown.trim()
  const subtaskLine = `- [ ] ${text}`
  if (!trimmed) return subtaskLine
  return `${trimmed}\n${subtaskLine}`
}

export default function TaskDetailDrawer({ taskId, columns, onClose, onUpdate }: TaskDetailDrawerProps) {
  const selectItem = useAppStore(s => s.selectItem)
  const toggleRightPanel = useAppStore(s => s.toggleRightPanel)
  const activeContext = useAppStore(s => s.activeContext)

  const [task, setTask] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  
  // Estimates: parsed from metadata.estimate
  const [estimate, setEstimate] = useState<number | ''>('')

  // Subtasks
  const [newSubtaskText, setNewSubtaskText] = useState('')

  // Editor mode
  const [editorMode, setEditorMode] = useState<EditorMode>('split')

  // Tags
  const [allTags, setAllTags] = useState<TagType[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [showTagSelector, setShowTagSelector] = useState(false)
  const [selectedTagColor, setSelectedTagColor] = useState('#3b82f6')

  // Relations
  const [relations, setRelations] = useState<Relation[]>([])
  const [relationSearchQuery, setRelationSearchQuery] = useState('')
  const [relationSearchResults, setRelationSearchResults] = useState<Item[]>([])
  const [selectedRelationType, setSelectedRelationType] = useState<RelationType>('relates_to')

  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useFocusTrap(!loading, titleInputRef)
  useEscapeKey(onClose, true)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Load details
  useEffect(() => {
    let active = true
    const loadDetails = async () => {
      setLoading(true)
      try {
        const itemsResult = await window.electronAPI.db.searchItems({
          query: taskId,
          context: activeContext,
          type: 'task'
        })
        const found = itemsResult.items.find(i => i.id === taskId)
        if (!found) {
          onCloseRef.current()
          return
        }
        
        if (active) {
          setTask(found)
          setTitle(found.title)
          setBody(found.body)
          setSelectedTagIds(found.tags?.map(t => t.id) || [])
          
          // Parse estimate from metadata
          try {
            const meta = JSON.parse(found.metadata)
            setEstimate(meta.estimate !== undefined ? Number(meta.estimate) : '')
          } catch {
            setEstimate('')
          }

          const tags = await window.electronAPI.db.getTags()
          setAllTags(tags)

          const rels = await window.electronAPI.db.getRelations(taskId)
          setRelations(rels)
        }
      } catch (err) {
        console.error('Failed to load task details:', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    loadDetails()
    return () => { active = false }
  }, [taskId, activeContext])

  // Search relation autocomplete
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
        setRelationSearchResults(res.items.filter(i => i.id !== taskId))
      } catch (err) {
        console.error('Failed to search items for relations:', err)
      }
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [relationSearchQuery, taskId, activeContext])

  const handleTitleBlur = () => {
    if (!task || !title.trim() || title === task.title) return
    onUpdate(task.id, { title: title.trim() })
  }

  const handleBodyBlur = () => {
    if (!task || body === task.body) return
    onUpdate(task.id, { body })
  }

  const handleEstimateBlur = () => {
    if (!task) return
    try {
      const meta = JSON.parse(task.metadata || '{}')
      const updatedMeta = {
        ...meta,
        estimate: estimate === '' ? undefined : Number(estimate)
      }
      const metadataStr = JSON.stringify(updatedMeta)
      onUpdate(task.id, { metadata: metadataStr })
      setTask(prev => prev ? { ...prev, metadata: metadataStr } : null)
    } catch (err) {
      console.error('Failed to save estimate:', err)
    }
  }

  const handlePriorityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!task) return
    const priority = parseInt(e.target.value) as Item['priority']
    onUpdate(task.id, { priority })
    setTask(prev => prev ? { ...prev, priority } : null)
  }

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!task) return
    const status = e.target.value
    onUpdate(task.id, { status })
    setTask(prev => prev ? { ...prev, status } : null)
  }

  const handleDueDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!task) return
    const dateVal = e.target.value
    const due_at = dateVal ? new Date(dateVal).getTime() : null
    onUpdate(task.id, { due_at })
    setTask(prev => prev ? { ...prev, due_at } : null)
  }

  const handleTagToggle = async (tagId: string) => {
    if (!task) return
    let updatedTags: string[]
    if (selectedTagIds.includes(tagId)) {
      updatedTags = selectedTagIds.filter(id => id !== tagId)
    } else {
      updatedTags = [...selectedTagIds, tagId]
    }
    
    setSelectedTagIds(updatedTags)
    await onUpdate(task.id, {}, updatedTags)
    
    const refreshedTags = allTags.filter(t => updatedTags.includes(t.id))
    setTask(prev => prev ? { ...prev, tags: refreshedTags } : null)
  }

  const handleToggleSubtask = async (lineIndex: number, currentChecked: boolean) => {
    if (!task) return
    const newBody = toggleSubTaskMarkdown(body, lineIndex, currentChecked)
    setBody(newBody)
    await onUpdate(task.id, { body: newBody })
    setTask(prev => prev ? { ...prev, body: newBody } : null)
  }

  const handleAddSubtaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSubtaskText.trim() || !task) return

    const newBody = addSubTaskMarkdown(body, newSubtaskText.trim())
    setBody(newBody)
    setNewSubtaskText('')
    await onUpdate(task.id, { body: newBody })
    setTask(prev => prev ? { ...prev, body: newBody } : null)
  }

  const handleAddRelation = async (targetId: string) => {
    if (!task) return
    try {
      await window.electronAPI.db.createRelation(task.id, targetId, selectedRelationType)
      const rels = await window.electronAPI.db.getRelations(task.id)
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
    if (!task) return
    selectItem(task.id)
    toggleRightPanel('ai-chat')
  }

  const subtasks = parseSubTasks(body)

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
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-muted)'
      }}>
        Loading details...
      </div>
    )
  }

  if (!task) return null

  return (
    <div style={{
      position: 'fixed',
      top: '32px',
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 1100,
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
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-modal-title"
      >
        {/* Header */}
        <div style={{
          height: '56px',
          padding: '0 var(--space-6)',
          borderBottom: '1px solid var(--color-surface-offset)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div>
            <span style={{
              fontSize: '10px',
              fontWeight: 'var(--weight-bold)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              padding: '2px 6px',
              borderRadius: '4px'
            }}>
              TASK #{task.id.substring(0, 8)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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

        {/* Scroll Body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-6)'
        }}>
          {/* Editable Title */}
          <div>
            <input
              ref={titleInputRef}
              id="task-modal-title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Enter task title..."
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

          {/* Properties Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'var(--space-4)',
            padding: 'var(--space-4)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-surface-offset)'
          }}>
            {/* Status (Column) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Status
              </span>
              <select
                value={task.status}
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

            {/* Priority */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Priority
              </span>
              <select
                value={task.priority}
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

            {/* Due Date */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Due Date
              </span>
              <input
                type="date"
                value={task.due_at ? new Date(task.due_at).toISOString().substring(0, 10) : ''}
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

            {/* Time Estimate */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Time Estimate (Hours)
              </span>
              <input
                type="number"
                value={estimate}
                onChange={e => setEstimate(e.target.value === '' ? '' : Number(e.target.value))}
                onBlur={handleEstimateBlur}
                placeholder="No estimate"
                min={0}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)', position: 'relative', gridColumn: 'span 2' }}>
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
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
                        id="drawer-new-tag-name"
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
                            document.getElementById('drawer-new-tag-create-btn')?.click()
                          }
                        }}
                      />
                      <button
                        id="drawer-new-tag-create-btn"
                        onClick={async () => {
                          const el = document.getElementById('drawer-new-tag-name') as HTMLInputElement
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
          </div>

          {/* Sub-tasks Checklist */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              Sub-Tasks Checklist
            </span>

            {subtasks.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-3.5)'
              }}>
                {subtasks.map(t => (
                  <div
                    key={t.index}
                    onClick={() => handleToggleSubtask(t.index, t.checked)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      fontSize: 'var(--text-xs)',
                      cursor: 'pointer',
                      color: t.checked ? 'var(--color-text-faint)' : 'var(--color-text-base)',
                      textDecoration: t.checked ? 'line-through' : 'none',
                      userSelect: 'none'
                    }}
                  >
                    {t.checked ? (
                      <CheckSquare size={14} style={{ color: 'var(--color-secondary)' }} />
                    ) : (
                      <Square size={14} style={{ color: 'var(--color-text-muted)' }} />
                    )}
                    <span>{t.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Add Subtask Form */}
            <form onSubmit={handleAddSubtaskSubmit} style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                type="text"
                value={newSubtaskText}
                onChange={e => setNewSubtaskText(e.target.value)}
                placeholder="Add sub-task item..."
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
                type="submit"
                disabled={!newSubtaskText.trim()}
                style={{
                  background: newSubtaskText.trim() ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
                  border: 'none',
                  color: newSubtaskText.trim() ? 'var(--color-text-inverted)' : 'var(--color-text-faint)',
                  borderRadius: 'var(--radius-md)',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: newSubtaskText.trim() ? 'pointer' : 'default',
                  flexShrink: 0
                }}
              >
                <Plus size={16} />
              </button>
            </form>
          </div>

          {/* Description Editor */}
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

            {/* Split Pane Editor */}
            <div style={{ display: 'flex', flex: 1, gap: 'var(--space-4)', minHeight: '260px' }}>
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

            {relations.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {relations.map(rel => {
                  const isFromCurrent = rel.from_id === taskId
                  const peerId = isFromCurrent ? rel.to_id : rel.from_id
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
                placeholder="Search task/card title to link..."
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


    </div>
  )
}
