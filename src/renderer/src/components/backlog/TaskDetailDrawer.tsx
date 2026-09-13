import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Markdown from '../ui/Markdown'
import { X, Tag, CheckSquare, Square, Plus } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useAiEnabled } from '../../lib/useAiEnabled'
import type { Item, Tag as TagType } from '../../../../shared/types'
import {
  parseChecklist,
  computeProgress,
  type Subtask
} from '../../../../shared/subtasks'
import useEscapeKey from '../ui/useEscapeKey'
import useFocusTrap from '../ui/useFocusTrap'
import TagRow from '../ui/TagRow'
import TagCreator from '../ui/TagCreator'
import RelationsPanel from '../ui/RelationsPanel'
import AiAssistButton from '../ui/AiAssistButton'
import { useItemRelations } from '../ui/useItemRelations'
import { listTags } from '../../data/tags'
import DrawerCloseButton from '../ui/DrawerCloseButton'
import { searchItems } from '../../data/items'
import { getRelations } from '../../data/relations'
import DetailTitleInput from '../ui/DetailTitleInput'
import * as subtasksApi from '../../data/subtasks'

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
      setSubtasks(await subtasksApi.list(id))
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

  const itemRelations = useItemRelations(taskId, task, activeWorkspace)
  const { setRelations } = itemRelations

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
        const itemsResult = await searchItems({
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

          const rels = await getRelations(taskId)
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
  }, [taskId, activeWorkspace, setRelations, loadSubtasks])

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
    await subtasksApi.update(subtask.id, { done: !subtask.done })
    if (task) loadSubtasks(task.id)
  }

  const handleDeleteSubtask = async (subtask: Subtask) => {
    setSubtasks(prev => prev.filter(s => s.id !== subtask.id))
    await subtasksApi.remove(subtask.id)
  }

  const handleAddSubtaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = newSubtaskText.trim()
    if (!title || !task) return
    setNewSubtaskText('')
    await subtasksApi.add(task.id, title)
    await loadSubtasks(task.id)
  }

  /** Rescues the checkboxes written before subtasks were real rows. */
  const handleConvertChecklist = async () => {
    if (!task) return
    const result = await subtasksApi.convert(task.id)
    if (!result.ok) return
    // Re-read rather than trusting a local edit: the conversion rewrote the body
    // in main, and this is the same lookup the drawer opens with.
    const found = await searchItems({
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
            {aiEnabled && <AiAssistButton onClick={handleAiAssist} />}

            <DrawerCloseButton onClick={onClose} />
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
            <DetailTitleInput
              inputRef={titleInputRef}
              id="task-modal-title"
              value={title}
              onChange={setTitle}
              onBlur={handleTitleBlur}
              placeholder="Enter task title..."
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
            <div className="col-sm">
              <span className="label-caps">
                Status
              </span>
              <select
                value={task.status}
                onChange={handleStatusChange}
                className="input-md"
              >
                {columns.map(col => (
                  <option key={col.id} value={col.id}>{col.name}</option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div className="col-sm">
              <span className="label-caps">
                Priority
              </span>
              <select
                value={task.priority}
                onChange={handlePriorityChange}
                className="input-md"
              >
                <option value={0}>None</option>
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </select>
            </div>

            {/* Due Date */}
            <div className="col-sm">
              <span className="label-caps">
                Due Date
              </span>
              <input
                type="date"
                value={task.due_at ? new Date(task.due_at).toISOString().substring(0, 10) : ''}
                onChange={handleDueDateChange}
                className="input-md"
              />
            </div>

            {/* Time Estimate */}
            <div className="col-sm">
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
                className="input-md"
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
                        <CheckSquare size={14} className="text-accent" />
                      ) : (
                        <Square size={14} className="text-muted" />
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
            <form onSubmit={handleAddSubtaskSubmit} className="flex-gap">
              <input
                type="text"
                value={newSubtaskText}
                onChange={e => setNewSubtaskText(e.target.value)}
                placeholder="Add sub-task item..."
                className="input-fill"
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
            <div className="section-head-between">
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

          <RelationsPanel links={itemRelations} placeholder="Search task/card title to link..." />
        </div>
      </div>


    </div>
  )
}
