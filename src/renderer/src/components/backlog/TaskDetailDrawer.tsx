import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Markdown from '../ui/Markdown'
import { X, Tag, Link2, Sparkles, CheckSquare, Square, Plus } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useAiEnabled } from '../../lib/useAiEnabled'
import type { Item, Tag as TagType, Relation, RelationType } from '../../../../shared/types'
import {
  parseChecklist,
  computeProgress,
  type Subtask
} from '../../../../shared/subtasks'
import useEscapeKey from '../ui/useEscapeKey'
import useFocusTrap from '../ui/useFocusTrap'
import TagRow from '../ui/TagRow'
import TagCreator from '../ui/TagCreator'
import { listTags } from '../../data/tags'

interface TaskDetailDrawerProps {
  taskId: string
  columns: Array<{ id: string; name: string }>
  onClose: () => void
  onUpdate: (id: string, patch: Partial<Item>, tagIds?: string[]) => Promise<void>
}

type EditorMode = 'edit' | 'preview' | 'split'


// Detecting the checkboxes people wrote before subtasks were real rows, so the
// drawer can offer to convert them. The parsing itself lives in shared/ and is
// the same code the conversion uses, so the count offered always matches what
// conversion produces.
function legacyChecklistOf(markdown: string): { title: string; done: boolean }[] {
  return parseChecklist(markdown).items
}

export default function TaskDetailDrawer({ taskId, columns, onClose, onUpdate }: TaskDetailDrawerProps) {
  const selectItem = useAppStore(s => s.selectItem)
  const toggleRightPanel = useAppStore(s => s.toggleRightPanel)
  const aiEnabled = useAiEnabled()
  const activeWorkspace = useAppStore(s => s.activeWorkspace)

  const [task, setTask] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  
  // Estimates: parsed from metadata.estimate
  const [estimate, setEstimate] = useState<number | ''>('')

  // Subtasks. Rows in their own table, not checkboxes in the body.
  const [newSubtaskText, setNewSubtaskText] = useState('')
  const [subtasks, setSubtasks] = useState<Subtask[]>([])

  const loadSubtasks = useCallback(async (id: string) => {
    try {
      setSubtasks(await window.electronAPI.subtasks.list(id))
    } catch (err) {
      console.error('Failed to load subtasks:', err)
    }
  }, [])

  // Editor mode
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
          context: activeWorkspace,
          type: 'task'
        })
        const found = itemsResult.items.find(i => i.id === taskId)
        if (!found) {
          onCloseRef.current()
          return
        }
        
        if (active) {
          setTask(found)
        loadSubtasks(found.id)
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

          const tags = await listTags()
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
  }, [taskId, activeWorkspace])

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
          context: activeWorkspace
        })
        setRelationSearchResults(res.items.filter(i => i.id !== taskId))
      } catch (err) {
        console.error('Failed to search items for relations:', err)
      }
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [relationSearchQuery, taskId, activeWorkspace])

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

  const handleToggleSubtask = async (subtask: Subtask) => {
    // Applied locally first: a checkbox that waits for a round trip feels broken.
    setSubtasks(prev => prev.map(s => (s.id === subtask.id ? { ...s, done: !s.done } : s)))
    await window.electronAPI.subtasks.update(subtask.id, { done: !subtask.done })
    if (task) loadSubtasks(task.id)
  }

  const handleDeleteSubtask = async (subtask: Subtask) => {
    setSubtasks(prev => prev.filter(s => s.id !== subtask.id))
    await window.electronAPI.subtasks.remove(subtask.id)
  }

  const handleAddSubtaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = newSubtaskText.trim()
    if (!title || !task) return
    setNewSubtaskText('')
    await window.electronAPI.subtasks.add(task.id, title)
    await loadSubtasks(task.id)
  }

  /** Rescues the checkboxes written before subtasks were real rows. */
  const handleConvertChecklist = async () => {
    if (!task) return
    const result = await window.electronAPI.subtasks.convert(task.id)
    if (!result.ok) return
    // Re-read rather than trusting a local edit: the conversion rewrote the body
    // in main, and this is the same lookup the drawer opens with.
    const found = await window.electronAPI.db.searchItems({
      query: task.id,
      context: activeWorkspace,
      type: 'task'
    })
    const refreshed = found.items.find(i => i.id === task.id)
    if (refreshed) {
      setBody(refreshed.body)
      setTask(refreshed)
    }
    await loadSubtasks(task.id)
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

  const legacyChecklist = legacyChecklistOf(body)
  const progress = useMemo(() => computeProgress(subtasks), [subtasks])

  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        top: '32px',
        right: 0,
        bottom: 0,
        width: '600px',
        maxWidth: '100vw',
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
          maxWidth: '100vw',
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

          <div className="row">
            {aiEnabled && <button
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
            </button>}

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
              <span className="label-caps">
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
              <span className="label-caps">
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
              <span className="label-caps">
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
              <span className="label-caps">
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
                  {allTags.map(tag => (
                    <TagRow
                      key={tag.id}
                      tag={tag}
                      isSelected={selectedTagIds.includes(tag.id)}
                      onToggle={handleTagToggle}
                      onTagsChanged={setAllTags}
                      onDeleted={id => setSelectedTagIds(prev => prev.filter(t => t !== id))}
                    />
                  ))}
                  {allTags.length === 0 && (
                    <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', padding: 'var(--space-2)' }}>
                      No tags available.
                    </span>
                  )}
                  
                  <TagCreator
                    onCreated={(created, tags) => {
                      setAllTags(tags)
                      handleTagToggle(created.id)
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Sub-tasks Checklist */}
          <div className="col">
            <span className="label-caps">
              Sub-Tasks Checklist
            </span>

            {subtasks.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <div style={{
                  flex: 1, height: '4px', borderRadius: '2px',
                  background: 'var(--color-surface-offset)', overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${Math.round(progress.ratio * 100)}%`,
                    height: '100%',
                    background: 'var(--color-secondary)',
                    transition: 'width 150ms ease'
                  }} />
                </div>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                  {progress.done}/{progress.total}
                </span>
              </div>
            )}

            {legacyChecklist.length > 0 && (
              <button
                className="btn-secondary"
                onClick={handleConvertChecklist}
                style={{ alignSelf: 'flex-start', marginBottom: 'var(--space-2)' }}
                title="Move the markdown checkboxes in the description into real subtasks"
              >
                Convert {legacyChecklist.length} checkbox{legacyChecklist.length === 1 ? '' : 'es'} from the description
              </button>
            )}

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
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      fontSize: 'var(--text-xs)',
                      color: t.done ? 'var(--color-text-faint)' : 'var(--color-text-base)',
                      userSelect: 'none'
                    }}
                  >
                    <button
                      onClick={() => handleToggleSubtask(t)}
                      aria-pressed={t.done}
                      aria-label={t.title}
                      style={{
                        display: 'flex', background: 'none', border: 'none',
                        padding: 0, cursor: 'pointer', flexShrink: 0
                      }}
                    >
                      {t.done ? (
                        <CheckSquare size={14} style={{ color: 'var(--color-secondary)' }} />
                      ) : (
                        <Square size={14} style={{ color: 'var(--color-text-muted)' }} />
                      )}
                    </button>
                    <span style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
                    <button
                      onClick={() => handleDeleteSubtask(t)}
                      title="Delete subtask"
                      aria-label={'Delete ' + t.title}
                      style={{
                        display: 'flex', background: 'none', border: 'none',
                        padding: 0, cursor: 'pointer', color: 'var(--color-text-faint)', flexShrink: 0
                      }}
                    >
                      <X size={12} />
                    </button>
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
                  <Markdown>{body}</Markdown>
                </div>
              )}
            </div>
          </div>

          {/* Relations Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <span className="label-caps">
              Linked Relations
            </span>

            {relations.length > 0 && (
              <div className="col">
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
