import React, { useState, useEffect, useRef } from 'react'
import KanbanCard from './KanbanCard'
import type { CardDisplay } from '../../../../shared/boardModel'
import { cardEdit, type CardSnapshot } from '../../../../shared/cardDraft'
import {
  appendCardChanges,
  describeCardChanges,
  readCardHistory,
  type CardChange
} from '../../../../shared/cardHistory'
import { DISPLAY_NAME_KEY, resolveAuthor } from '../../../../shared/identity'
import Markdown from '../ui/Markdown'
import { Tag, Check } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useAiEnabled } from '../../lib/useAiEnabled'
import type { Item, Tag as TagType } from '../../../../shared/types'
import useEscapeKey from '../ui/useEscapeKey'
import useFocusTrap from '../ui/useFocusTrap'
import { handleImagePaste, handleImageDrop } from '../../lib/mediaHelper'
import RewindPanel from './RewindPanel'
import { getStringSetting } from '../../lib/settings'
import TagRow from '../ui/TagRow'
import TagCreator from '../ui/TagCreator'
import RelationsPanel from '../ui/RelationsPanel'
import AiAssistButton from '../ui/AiAssistButton'
import { useItemRelations } from '../ui/useItemRelations'
import CardAttachments, { type CardAttachment } from './CardAttachments'
import CardChecklist from './CardChecklist'
import CardCoverPicker, { type CardCover } from './CardCoverPicker'
import CardDiscussion from './CardDiscussion'
import CardTextureTools from './CardTextureTools'
import { listTags } from '../../data/tags'
import { readItems } from '../../data/items'
import DrawerCloseButton from '../ui/DrawerCloseButton'
import { getRelations } from '../../data/relations'
import DetailTitleInput from '../ui/DetailTitleInput'
import * as appApi from '../../data/app'

interface CardDetailModalProps {
  cardId: string
  initialCard?: Item
  columns: Array<{ id: string; name: string }>
  onClose: () => void
  onUpdate: (id: string, patch: Partial<Item>, tagIds?: string[]) => Promise<void>
  /** the board's field switches, so the preview matches */
  cardDisplay?: CardDisplay
  isReadOnly?: boolean
}

type EditorMode = 'edit' | 'preview' | 'split'

export default function CardDetailModal({ cardId, initialCard, columns, onClose, onUpdate, cardDisplay, isReadOnly = false }: CardDetailModalProps) {
  const selectItem = useAppStore(s => s.selectItem)
  const toggleRightPanel = useAppStore(s => s.toggleRightPanel)
  const aiEnabled = useAiEnabled()
  const activeWorkspace = useAppStore(s => s.activeWorkspace)

  const [card, setCard] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  
  const [editorMode, setEditorMode] = useState<EditorMode>('split')

  const [allTags, setAllTags] = useState<TagType[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [showTagSelector, setShowTagSelector] = useState(false)

  const itemRelations = useItemRelations(cardId, card, activeWorkspace)
  const { setRelations } = itemRelations

  const [cover, setCover] = useState<{ type: 'color' | 'image'; value: string; size?: 'header' | 'full' } | null>(null)
  const [checklist, setChecklist] = useState<Array<{ id: string; text: string; done: boolean }>>([])
  const [comments, setComments] = useState<Array<{ id: string; user: string; text: string; createdAt: number }>>([])
  const [activities, setActivities] = useState<CardChange[]>([])
  /** read per open, credited with the save */
  const [displayName, setDisplayName] = useState('')
  const [draggingAttachment, setDraggingAttachment] = useState(false)
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; path: string; isImage: boolean; createdAt: number }>>([])
  const [isTemplate, setIsTemplate] = useState(false)
  const [dueDateCompleted, setDueDateCompleted] = useState(false)
  
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

  useEffect(() => {
    let active = true
    const loadDetails = async () => {
      setLoading(true)
      try {
        let found: Item | null = initialCardRef.current || null
        if (!found) {
          const res = await readItems(activeWorkspace, 'card')
          found = res.find(i => i.id === cardId) || null
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
          setActivities(readCardHistory(meta.activities))
          setAttachments(meta.attachments || [])
          setIsTemplate(meta.isTemplate === true)
          setDueDateCompleted(meta.dueDateCompleted === true)

          // distinct objects: disk vs screen, they diverge once anything's drafted
          savedMetaRef.current = { ...meta }
          latestMetaRef.current = { ...meta }

          // baseline for every buffered edit
          savedRef.current = {
            title: found.title.trim(),
            body: found.body,
            priority: found.priority,
            status: found.status,
            due_at: found.due_at,
            metadata: found.metadata || '{}',
            tagIds: found.tags?.map(t => t.id) || []
          }


          const tags = await listTags()
          setAllTags(tags)

          const rawName = await getStringSetting(DISPLAY_NAME_KEY, '')
          // account name when the field's empty, so entries aren't credited to nobody
          if (active) setDisplayName(resolveAuthor(rawName, appApi.osUserName()))

          const rels = await getRelations(cardId)
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
  }, [cardId, activeWorkspace, setRelations])

  /** last written state, compared to decide what to save */
  const savedRef = useRef<CardSnapshot | null>(null)
  const [saving, setSaving] = useState(false)

  const current: CardSnapshot | null = card && {
    title,
    body,
    priority: card.priority,
    status: card.status,
    due_at: card.due_at,
    metadata: card.metadata || '{}',
    tagIds: selectedTagIds
  }
  const edit = savedRef.current && current ? cardEdit(savedRef.current, current) : null
  const dirty = edit?.dirty === true

  /** "Moved to In Review", not in_review */
  const columnName = (status: string): string =>
    columns.find(c => c.id === status)?.name ?? status

  /** the working copy already has the buffered fields; only the two text fields get laid over */
  const previewCard: Item | null = card && {
    ...card,
    title: title.trim() || 'Untitled',
    body
  }

  /** modal-bound, not global; ref so the listener registers once */
  const saveRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      void saveRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleSave = async () => {
    const snapshot = current
    const baseline = savedRef.current
    // a real guard: the drawer blocks the mouse, not the keyboard
    if (isReadOnly || !card || !edit || !edit.dirty || saving || !snapshot || !baseline) return
    setSaving(true)
    try {
      // history rides in the same metadata write, so an entry never describes a change that didn't land
      const phrases = describeCardChanges(baseline, snapshot, columnName)
      const history = appendCardChanges(activities, phrases, displayName, Date.now())
      const written = phrases.length > 0
        ? { ...snapshot, metadata: JSON.stringify({ ...latestMetaRef.current, activities: history }) }
        : snapshot

      const write = cardEdit(baseline, written)
      await onUpdate(card.id, write.patch, write.tagIds)

      if (written !== snapshot) {
        latestMetaRef.current = { ...latestMetaRef.current, activities: history }
        setActivities(history)
      }
      // everything's written, the two agree again
      try {
        savedMetaRef.current = JSON.parse(written.metadata)
      } catch {
        savedMetaRef.current = { ...latestMetaRef.current }
      }
      // only the baseline moves; title from the patch since the field may hold trimmed whitespace
      savedRef.current = { ...written, title: write.patch.title ?? baseline.title }
      setCard(prev => prev ? { ...prev, ...write.patch } : null)
      if (write.patch.title) setTitle(write.patch.title)
    } catch (err) {
      console.error('Failed to save the card:', err)
    } finally {
      setSaving(false)
    }
  }
  saveRef.current = handleSave

  /** tracked twice: savedMetaRef is disk, latestMetaRef adds drafts; one ref let a comment save an unsaved cover */
  const savedMetaRef = useRef<Record<string, unknown>>({})
  const latestMetaRef = useRef<Record<string, unknown>>({})

  /** writes something that already happened, drafts stay out */
  const updateMetadata = async (newMetaPatch: Record<string, unknown>) => {
    if (!card) return
    // built on disk, not the working copy
    const written = { ...savedMetaRef.current, ...newMetaPatch }
    const serialized = JSON.stringify(written)
    savedMetaRef.current = written

    // the working copy keeps its drafts
    latestMetaRef.current = { ...latestMetaRef.current, ...newMetaPatch }
    setCard(prev => prev ? { ...prev, metadata: JSON.stringify(latestMetaRef.current) } : null)
    // baseline moves so this doesn't read as unsaved
    if (savedRef.current) savedRef.current = { ...savedRef.current, metadata: serialized }

    await onUpdate(card.id, { metadata: serialized })
  }

  /** cover and template flag wait for Save */
  const draftMetadata = (newMetaPatch: Record<string, unknown>) => {
    if (!card) return
    const mergedMeta = { ...latestMetaRef.current, ...newMetaPatch }
    latestMetaRef.current = mergedMeta
    setCard(prev => prev ? { ...prev, metadata: JSON.stringify(mergedMeta) } : null)
  }

  /** logs already-written actions; Save logs the buffered edits */
  const addActivity = (text: string) => {
    const updated = appendCardChanges(activities, [text], displayName, Date.now())
    setActivities(updated)
    updateMetadata({ activities: updated })
  }

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

  const handlePostComment = () => {
    if (!commentInput.trim()) return
    const newComment = {
      id: `com-${Date.now()}`,
      user: displayName,
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

  /** file picker and drop zone, many at once */
  const attachFiles = (files: FileList | File[]) => {
    const at = Date.now()
    const added = Array.from(files)
      .map((file, i) => ({
        // indexed, a multi-file drop lands in one ms
        id: `att-${at}-${i}`,
        name: file.name,
        // electron 32 dropped File.path, resolve via preload
        path: appApi.getPathForFile(file),
        isImage: file.type.startsWith('image/'),
        createdAt: at
      }))
      // files not on this disk (browser drags) have no path, skip them
      .filter(a => a.path)

    if (added.length === 0) return

    const updated = [...attachments, ...added]
    setAttachments(updated)
    updateMetadata({ attachments: updated })
    addActivity(
      added.length === 1 ? `Attached file: "${added[0].name}"` : `Attached ${added.length} files`
    )
  }

  const handleAddFileAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) attachFiles(e.target.files)
  }

  const handleSetCoverImage = (urlOrPath: string) => {
    setCover({ type: 'image', value: urlOrPath })
    draftMetadata({ cover: { type: 'image', value: urlOrPath } })
  }

  const handleCoverChange = (next: CardCover | null) => {
    setCover(next)
    draftMetadata({ cover: next })
  }

  const handleRemoveAttachment = (att: CardAttachment) => {
    const updated = attachments.filter(a => a.id !== att.id)
    setAttachments(updated)
    updateMetadata({ attachments: updated })
    addActivity(`Removed attachment "${att.name}"`)
  }

  const handlePriorityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!card) return
    const priority = parseInt(e.target.value) as Item['priority']
    setCard(prev => prev ? { ...prev, priority } : null)
  }

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!card) return
    const status = e.target.value
    setCard(prev => prev ? { ...prev, status } : null)
  }

  const handleDueDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!card) return
    const dateVal = e.target.value
    const due_at = dateVal ? new Date(dateVal).getTime() : null
    setCard(prev => prev ? { ...prev, due_at } : null)
  }

  const handleTagToggle = (tagId: string) => {
    if (!card) return
    const updatedTags = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter(id => id !== tagId)
      : [...selectedTagIds, tagId]

    setSelectedTagIds(updatedTags)
    const refreshedTags = allTags.filter(t => updatedTags.includes(t.id))
    setCard(prev => prev ? { ...prev, tags: refreshedTags } : null)
  }

  const handleAiAssist = () => {
    if (!card) return
    // pre-seed the AI panel's context
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
        onClick={e => e.stopPropagation()} // don't close on drawer click
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-modal-title"
      >
        <div
          id="card-modal-cover-banner"
          style={{
            height: cover?.type === 'color' ? '48px' : (cover?.type === 'image' ? '110px' : '0px'),
            backgroundColor: cover?.type === 'color' ? cover.value : 'transparent',
            backgroundImage: cover?.type === 'image' ? `url(${cover.value})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            width: '100%',
            flexShrink: 0,
            transition: 'height 0.2s ease, background-color 0.15s ease'
          }}
        />
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
            {aiEnabled && <AiAssistButton onClick={handleAiAssist} />}

            {/* only when there's something to write */}
            {!isReadOnly && dirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                title="Save changes (Ctrl+S)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  background: 'var(--color-secondary)',
                  border: 'none',
                  color: 'var(--color-text-inverted)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-4)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.6 : 1
                }}
              >
                <Check size={14} strokeWidth={3} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}

            <DrawerCloseButton onClick={onClose} title={dirty ? 'Close and discard the unsaved changes' : 'Close'} />
          </div>
        </div>

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
          <div>
            <DetailTitleInput
              inputRef={titleInputRef}
              id="card-modal-title"
              value={title}
              onChange={setTitle}
              placeholder="Enter card title..."
            />
          </div>

          {/* the board's own card component, inert at column width, so the preview can't drift */}
          {previewCard && (
            <div>
              <span className="label-caps" style={{ fontSize: '10px' }}>On The Board</span>
              {/* inert, not pointer-events: tabbing in and pressing Space jumped to Focus */}
              <div
                ref={node => { node?.setAttribute('inert', '') }}
                aria-hidden
                style={{ width: '280px', maxWidth: '100%', marginTop: 'var(--space-2)' }}
              >
                <KanbanCard
                  card={previewCard}
                  display={cardDisplay}
                  onClick={() => {}}
                  onDelete={() => {}}
                  onConvertToTask={() => {}}
                  isOverlay
                />
              </div>
            </div>
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'var(--space-4)',
            padding: 'var(--space-4)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-surface-offset)'
          }}>
            <div className="col-sm">
              <span className="label-caps">
                Status
              </span>
              <select
                value={card.status}
                onChange={handleStatusChange}
                className="input-md"
              >
                {columns.map(col => (
                  <option key={col.id} value={col.id}>{col.name}</option>
                ))}
              </select>
            </div>

            <div className="col-sm">
              <span className="label-caps">
                Priority
              </span>
              <select
                value={card.priority}
                onChange={handlePriorityChange}
                className="input-md"
              >
                <option value={0}>None</option>
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </select>
            </div>

            <div className="col-sm">
              <span className="label-caps">
                Due Date
              </span>
              <div className="row-8px">
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
                        draftMetadata({ dueDateCompleted: val })
                      }}
                    />
                    <span>Done</span>
                  </label>
                )}
              </div>
            </div>

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

            <CardCoverPicker cover={cover} onChange={handleCoverChange} />

            <div className="col-sm">
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
                      draftMetadata({ isTemplate: val })
                    }}
                  />
                  <span>Mark as Template</span>
                </label>
              </div>
            </div>
          </div>


          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1, minHeight: '300px' }}>
            <div className="section-head-between">
              <span className="label-caps">
                Description (Markdown)
              </span>
              
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

            {/* split only: an empty card's panes are indistinguishable without labels */}
            {editorMode === 'split' && (
              <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                <span className="label-caps" style={{ flex: 1, fontSize: '10px' }}>Markdown</span>
                <span className="label-caps" style={{ flex: 1, fontSize: '10px' }}>Preview</span>
              </div>
            )}

            <div style={{ display: 'flex', flex: 1, gap: 'var(--space-4)', minHeight: '260px' }}>
              {(editorMode === 'edit' || editorMode === 'split') && (
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onPaste={async (e) => {
                    const isImage = await handleImagePaste(e, body, setBody)
                    if (isImage) return
                  }}
                  onDrop={async (e) => {
                    await handleImageDrop(e, body, setBody)
                  }}
                  onDragOver={e => e.preventDefault()}
                  placeholder="Enter details..."
                  className="border-offset focus-border-primary"
                  style={{
                    flex: 1,
                    background: 'var(--color-surface-2)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-4)',
                    color: 'var(--color-text-base)',
                    fontSize: 'var(--text-sm)',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none',
                    resize: 'none',
                    lineHeight: 1.5
                  }}
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
                  {!body.trim() && (
                    <span style={{ color: 'var(--color-text-faint)', fontStyle: 'italic' }}>
                      Nothing to preview yet.
                    </span>
                  )}
                  <Markdown>{body}</Markdown>
                </div>
              )}
            </div>
          </div>

          <CardTextureTools body={body} cardId={card.id} onClose={onClose} />

          <RelationsPanel links={itemRelations} placeholder="Search card title to link..." />

          <CardChecklist
            items={checklist}
            draft={newChecklistText}
            setDraft={setNewChecklistText}
            onAdd={handleAddChecklistItem}
            onToggle={handleToggleChecklistItem}
            onDelete={handleDeleteChecklistItem}
          />

          <CardAttachments
            attachments={attachments}
            isReadOnly={isReadOnly}
            dragging={draggingAttachment}
            setDragging={setDraggingAttachment}
            linkName={newLinkName}
            setLinkName={setNewLinkName}
            linkUrl={newLinkUrl}
            setLinkUrl={setNewLinkUrl}
            onAttachFiles={attachFiles}
            onAddLink={handleAddLinkAttachment}
            onFileChosen={handleAddFileAttachment}
            onSetCover={handleSetCoverImage}
            onRemove={handleRemoveAttachment}
          />

          {/* rewind sits with the history, not above the description */}
          {card && (
            <div style={{ borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
              <RewindPanel item={card} />
            </div>
          )}

          <CardDiscussion
            comments={comments}
            activities={activities}
            draft={commentInput}
            setDraft={setCommentInput}
            onPost={handlePostComment}
            onDelete={handleDeleteComment}
          />
        </div>
      </div>


    </div>
  )
}
