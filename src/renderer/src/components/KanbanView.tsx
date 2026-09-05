import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Tag } from '../../../shared/types'
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  rectIntersection,
  pointerWithin,
  CollisionDetection,
  MeasuringStrategy
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import KanbanColumn from './kanban/KanbanColumn'
import KanbanCard from './kanban/KanbanCard'
import CardDetailModal from './kanban/CardDetailModal'
import AddColumnModal from './kanban/AddColumnModal'
import { useAppStore } from '../store/appStore'
import type { Item } from '../../../shared/types'
import { Plus, Layers, LayoutGrid, KanbanSquare, Upload, Eye } from 'lucide-react'
import Skeleton from './ui/Skeleton'
import ConfirmDialog, { useConfirm } from './ui/ConfirmDialog'
import useFocusTrap from './ui/useFocusTrap'
import useEscapeKey from './ui/useEscapeKey'
import EmptyState from './ui/EmptyState'
import { useToast } from './ui/Toast'
import ColorPicker from './ui/ColorPicker'
import {
  loadBoardConfig,
  patchBoardConfig,
  DEFAULT_CARD_DISPLAY,
  type BoardConfig,
  type CardDisplay,
  type ColumnConfig,
  type ColumnSort
} from '../lib/boardConfig'
import { WebRTCCollaborationCoordinator } from '../lib/webrtcCollaboration'
import { errorMessage } from '../../../shared/errors'


// Re-exported rather than declared: the shape now belongs to lib/boardConfig,
// which owns the whole board document. Kept as an export so existing importers
// of ColumnConfig from this module keep working.
export type { ColumnConfig }

/** The card face fields a board can switch on and off. */
const CARD_DISPLAY_FIELDS: { key: keyof CardDisplay; label: string }[] = [
  { key: 'priority', label: 'Priority Bar' },
  { key: 'tags', label: 'Tags' },
  { key: 'due', label: 'Due Date' },
  { key: 'bodyPreview', label: 'Body Preview' }
]

const BG_STYLES: Record<string, string> = {
  default: 'var(--color-background)',
  charcoal: '#13141a',
  indigo: '#0a0b12',
  slate: '#1e293b',
  midnight: '#090d16',
  cyberpunk: '#120824',
  nordic: '#1a202c',
  ocean: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
  cosmic: 'linear-gradient(135deg, #0f0c20 0%, #2b1055 50%, #7597de 100%)',
  sunset: 'linear-gradient(135deg, #2d0b3f 0%, #7b1fa2 50%, #e91e63 100%)',
  aurora: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  forest: 'linear-gradient(135deg, #062c1e 0%, #114b32 50%, #1b7a52 100%)',
  cyber: 'linear-gradient(135deg, #18002e 0%, #4a0072 50%, #ff007f 100%)',
  gold: 'linear-gradient(135deg, #141414 0%, #2a2415 50%, #4a3e1b 100%)',
  ruby: 'linear-gradient(135deg, #210409 0%, #520b18 50%, #8c162b 100%)'
}

function getBoardBackgroundStyle(bg: string): string {
  if (!bg) return BG_STYLES.default
  if (BG_STYLES[bg]) {
    const val = BG_STYLES[bg]
    return val.startsWith('url') ? `${val} center / cover no-repeat` : val
  }
  if (bg.startsWith('http://') || bg.startsWith('https://') || bg.startsWith('data:') || bg.startsWith('file://') || bg.startsWith('url(')) {
    return bg.startsWith('url(') ? bg : `url("${bg}") center / cover no-repeat`
  }
  return bg
}

const customCollisionDetection: CollisionDetection = (args) => {
  if (String(args.active.id).startsWith('col::')) {
    return rectIntersection(args)
  }
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions
  return rectIntersection(args)
}

// Shared stable reference for empty columns, so the memoized column never
// re-renders just because it received a freshly-allocated [] each render.
const EMPTY_ITEMS: Item[] = []

interface SortableColumnProps {
  col: ColumnConfig
  cards: Item[]
  onRename: (id: string, name: string, wipLimit: number | null, color?: string, colorMode?: 'header' | 'full') => void
  onDelete: (id: string) => void
  onCardClick: (id: string) => void
  onCardDelete: (id: string) => void
  onCardConvertToTask: (id: string) => void
  onAddCard: (colId: string) => void
  onCardUpdate?: (id: string, patch: Partial<Item>) => Promise<void>
  onClearColumn?: (columnId: string) => void
  onArchiveColumn?: (columnId: string) => void
  isReadOnly?: boolean
  onToggleCollapse?: (columnId: string) => void
  onSetSort?: (columnId: string, sort: ColumnSort) => void
  cardDisplay?: CardDisplay
}

function areSortableColumnPropsEqual(prev: SortableColumnProps, next: SortableColumnProps) {
  if (prev.isReadOnly !== next.isReadOnly) return false
  if (
    prev.col.id !== next.col.id ||
    prev.col.name !== next.col.name ||
    prev.col.wipLimit !== next.col.wipLimit ||
    prev.col.color !== next.col.color ||
    prev.col.colorMode !== next.col.colorMode
  ) return false
  if (prev.cards.length !== next.cards.length) return false
  for (let i = 0; i < prev.cards.length; i++) {
    if (prev.cards[i] !== next.cards[i]) return false
  }
  return true
}

// Sortable column wrapper so columns themselves can be reordered via drag
const SortableColumn = React.memo(function SortableColumn({
  col,
  cards,
  onRename,
  onDelete,
  onCardClick,
  onCardDelete,
  onCardConvertToTask,
  onAddCard,
  onCardUpdate,
  onClearColumn,
  onArchiveColumn,
  isReadOnly = false,
  onToggleCollapse,
  onSetSort,
  cardDisplay
}: SortableColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: `col::${col.id}` })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        height: '100%',
        minHeight: 0,
        flexShrink: 0
      }}
    >
      <KanbanColumn
        id={col.id}
        name={col.name}
        wipLimit={col.wipLimit}
        color={col.color}
        colorMode={col.colorMode}
        cards={cards}
        onRename={onRename}
        onDelete={onDelete}
        onCardClick={onCardClick}
        onCardDelete={onCardDelete}
        onCardConvertToTask={onCardConvertToTask}
        onAddCard={onAddCard}
        onCardUpdate={onCardUpdate}
        onClearColumn={onClearColumn}
        onArchiveColumn={onArchiveColumn}
        dragHandleProps={{ ...attributes, ...listeners }}
        isReadOnly={isReadOnly}
        collapsed={col.collapsed}
        onToggleCollapse={onToggleCollapse}
        sort={col.sort}
        onSetSort={onSetSort}
        description={col.description}
        cardDisplay={cardDisplay}
      />
    </div>
  )
}, areSortableColumnPropsEqual)

export default function KanbanView() {
  const activeContext = useAppStore(s => s.activeContext)
  const availableContexts = useAppStore(s => s.availableContexts)
  const contextsList = useAppStore(s => s.contextsList)
  const setContext = useAppStore(s => s.setContext)
  const setView = useAppStore(s => s.setView)
  const setSettingsTab = useAppStore(s => s.setSettingsTab)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const { toast } = useToast()
  const confirm = useConfirm()

  const [cards, setCards] = useState<Item[]>([])
  const [columns, setColumns] = useState<ColumnConfig[]>([])
  const [swimlanesEnabled, setSwimlanesEnabled] = useState(false)
  const [cardDisplay, setCardDisplay] = useState<CardDisplay>(DEFAULT_CARD_DISPLAY)
  const [showCardDisplayMenu, setShowCardDisplayMenu] = useState(false)
  const cardDisplayRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  // Always-latest columns snapshot. Column mutations read/write through this so
  // two quick edits (e.g. deleting two columns in a row) can never operate on a
  // stale closure and resurrect a just-removed column.
  const columnsRef = useRef<ColumnConfig[]>([])
  useEffect(() => { columnsRef.current = columns }, [columns])

  // Single source of truth for writing the column list: updates the ref
  // synchronously, the state, and the persisted setting the AI also reads.
  const persistColumns = useCallback(async (next: ColumnConfig[]): Promise<void> => {
    columnsRef.current = next
    setColumns(next)
    try {
      await patchBoardConfig(activeContext, { columns: next })
    } catch (err) {
      console.error('Failed to persist columns:', err)
    }
  }, [activeContext])

  /** Writes any other slice of the board document; state is set by the caller. */
  const persistConfig = useCallback(async (patch: Partial<BoardConfig>): Promise<void> => {
    try {
      await patchBoardConfig(activeContext, patch)
    } catch (err) {
      console.error('Failed to persist board config:', err)
    }
  }, [activeContext])

  /** Applies a change to one column and persists the whole list. */
  const updateColumn = useCallback((colId: string, patch: Partial<ColumnConfig>): void => {
    const next = columnsRef.current.map(c => (c.id === colId ? { ...c, ...patch } : c))
    persistColumns(next)
  }, [persistColumns])

  const handleToggleCollapse = useCallback((colId: string): void => {
    const col = columnsRef.current.find(c => c.id === colId)
    updateColumn(colId, { collapsed: !col?.collapsed })
  }, [updateColumn])

  const handleSetColumnSort = useCallback((colId: string, sort: ColumnSort): void => {
    updateColumn(colId, { sort })
  }, [updateColumn])

  const [showAddColModal, setShowAddColModal] = useState(false)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  const rightPanelOpen = useAppStore(s => s.rightPanelOpen)

  // Mutual exclusivity between Card details drawer and AI assistant panel
  useEffect(() => {
    if (activeCardId) {
      const store = useAppStore.getState()
      if (store.rightPanelOpen) {
        store.setRightPanelContent(null)
      }
    }
  }, [activeCardId])

  useEffect(() => {
    if (rightPanelOpen && activeCardId) {
      setActiveCardId(null)
    }
  }, [rightPanelOpen])

  const [activeDragCard, setActiveDragCard] = useState<Item | null>(null)
  const [pendingDeleteColId, setPendingDeleteColId] = useState<string | null>(null)

  // Advanced Kanban States
  const [boardBg, setBoardBg] = useState<string>('default')
  const [customBgTab, setCustomBgTab] = useState<'presets' | 'solid' | 'gradient' | 'image'>('presets')
  const [customSolidColor, setCustomSolidColor] = useState('#1e293b')
  const [customGradStart, setCustomGradStart] = useState('#1e3c72')
  const [customGradEnd, setCustomGradEnd] = useState('#2a5298')
  const [customGradAngle, setCustomGradAngle] = useState<number>(135)
  const [customGradType, setCustomGradType] = useState<'linear' | 'radial'>('linear')
  const [customImageUrl, setCustomImageUrl] = useState('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [filterPriority, setFilterPriority] = useState<number>(-1)
  const [filterTagId, setFilterTagId] = useState<string>('all')
  const [allTags, setAllTags] = useState<Tag[]>([])

  const [archivedColumns, setArchivedColumns] = useState<ColumnConfig[]>([])
  const [showArchiveBin, setShowArchiveBin] = useState(false)
  const closeArchiveBin = useCallback(() => setShowArchiveBin(false), [])
  const archiveBinRef = useFocusTrap(showArchiveBin)
  useEscapeKey(closeArchiveBin, showArchiveBin)
  const [selectedArchived, setSelectedArchived] = useState<Set<string>>(new Set())
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)
  const [showBgSelector, setShowBgSelector] = useState(false)

  // WebRTC Board Collaboration States
  const [collabActive, setCollabActive] = useState(false)
  const [collabIsHost, setCollabIsHost] = useState(false)
  const [collabCode, setCollabCode] = useState('')
  const [collabMode, setCollabMode] = useState<'collaborative' | 'readonly'>('collaborative')
  const [collabProgress, setCollabProgress] = useState('Idle')
  const [showCollabPopover, setShowCollabPopover] = useState(false)
  const [joinCodeInput, setJoinCodeInput] = useState('')

  const collabCoordinatorRef = useRef<WebRTCCollaborationCoordinator | null>(null)
  const collabPopoverRef = useRef<HTMLDivElement>(null)

  const isReadOnlyMode = collabActive && collabMode === 'readonly' && !collabIsHost

  const startCollabHosting = useCallback(async (mode: 'collaborative' | 'readonly') => {
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    setCollabActive(true)
    setCollabIsHost(true)
    setCollabCode(code)
    setCollabMode(mode)
    setCollabProgress('Initializing host signal room...')

    const coord = new WebRTCCollaborationCoordinator({
      pairingCode: code,
      isHost: true,
      context: activeContext,
      mode,
      onProgress: (p) => setCollabProgress(p),
      onConnect: () => setCollabProgress('Connected to Peer!'),
      onDisconnect: () => {
        setCollabProgress('Peer disconnected.')
        setCollabActive(false)
      },
      onError: (err) => {
        setCollabProgress(`Error: ${errorMessage(err)}`)
        setCollabActive(false)
      },
      // The host keeps its own board; only a joining peer is ever asked.
      onConfirmBaseline: async () => true
    })
    collabCoordinatorRef.current = coord
    await coord.start()
  }, [activeContext])

  const joinCollabSession = useCallback(async (code: string) => {
    if (!code || code.length < 5) return
    setCollabActive(true)
    setCollabIsHost(false)
    setCollabCode(code)
    setCollabProgress('Initiating connection...')

    const coord = new WebRTCCollaborationCoordinator({
      pairingCode: code,
      isHost: false,
      context: activeContext,
      mode: 'collaborative', // Client infers mode from baseline message
      onProgress: (p) => setCollabProgress(p),
      onConnect: () => setCollabProgress('Connected to Peer!'),
      onDisconnect: () => {
        setCollabProgress('Host disconnected.')
        setCollabActive(false)
      },
      onError: (err) => {
        setCollabProgress(`Error: ${errorMessage(err)}`)
        setCollabActive(false)
      },
      onConfirmBaseline: async ({ context, incomingItems }) =>
        confirm({
          title: 'Replace this board?',
          message:
            `Joining will delete every card and task in "${context}" on this computer ` +
            `and replace them with the host's ${incomingItems} item(s). This cannot be undone.`,
          confirmText: 'Replace my board'
        })
    })
    collabCoordinatorRef.current = coord
    await coord.start()
  }, [activeContext, confirm])

  const disconnectCollab = useCallback(() => {
    if (collabCoordinatorRef.current) {
      collabCoordinatorRef.current.cleanup()
      collabCoordinatorRef.current = null
    }
    setCollabActive(false)
    setCollabIsHost(false)
    setCollabCode('')
    setCollabProgress('Disconnected')
  }, [])

  useEffect(() => {
    return () => {
      if (collabCoordinatorRef.current) {
        collabCoordinatorRef.current.cleanup()
      }
    }
  }, [])

  const templateSelectorRef = useRef<HTMLDivElement>(null)
  const bgSelectorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      toast('Image is too large (max 8MB)', { type: 'error' })
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      if (dataUrl) {
        setCustomImageUrl(dataUrl)
      }
    }
    reader.readAsDataURL(file)
  }

  // Sensors: use a distance threshold to distinguish click vs drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Click Outside Closures
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (templateSelectorRef.current && !templateSelectorRef.current.contains(e.target as Node)) {
        setShowTemplateSelector(false)
      }
      if (bgSelectorRef.current && !bgSelectorRef.current.contains(e.target as Node)) {
        setShowBgSelector(false)
      }
      if (cardDisplayRef.current && !cardDisplayRef.current.contains(e.target as Node)) {
        setShowCardDisplayMenu(false)
      }
      if (collabPopoverRef.current && !collabPopoverRef.current.contains(e.target as Node)) {
        setShowCollabPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Data Loading

  const loadColumns = useCallback(async () => {
    try {
      // One document now covers columns, background, swimlanes and the archive
      // bin, so this is a single read where it used to be four. loadBoardConfig
      // holds the same `kanban-cols:` lock the AI action blocks take, which is
      // what stops the board bootstrap and a concurrent AI write from both
      // seeing "empty" and each installing its own default column set.
      const config = await loadBoardConfig(activeContext)
      setColumns(config.columns)
      setSwimlanesEnabled(config.swimlanes)
      setBoardBg(config.background)
      setArchivedColumns(config.archivedColumns)
      setCardDisplay(config.cardDisplay)
    } catch (err) {
      console.error('Failed to load Kanban column settings:', err)
    }
  }, [activeContext])

  const loadCards = useCallback(async () => {
    try {
      const res = await window.electronAPI.db.getItems(activeContext, 'card', 1, 1000)
      setCards(res.items)
    } catch (err) {
      console.error('Failed to load Kanban cards:', err)
    }
  }, [activeContext])

  const loadTags = useCallback(async () => {
    try {
      const tags = await window.electronAPI.db.getTags()
      setAllTags(tags)
    } catch (err) {
      console.error('Failed to load tags:', err)
    }
  }, [])

  const initializeBoard = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadColumns(), loadCards(), loadTags()])
    setLoading(false)
  }, [loadColumns, loadCards, loadTags])

  useEffect(() => {
    initializeBoard()
  }, [initializeBoard])

  useEffect(() => {
    const handleBoardUpdate = () => {
      loadCards()
      loadColumns()
    }
    window.addEventListener('item-updated', handleBoardUpdate)
    window.addEventListener('kanban-refresh', handleBoardUpdate)
    return () => {
      window.removeEventListener('item-updated', handleBoardUpdate)
      window.removeEventListener('kanban-refresh', handleBoardUpdate)
    }
  }, [loadCards, loadColumns])

  // Drag & Drop

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (isReadOnlyMode) return
    const { active } = event
    const id = active.id as string
    if (!id.startsWith('col::')) {
      setCards(currentCards => {
        const found = currentCards.find(c => c.id === id)
        if (found) setActiveDragCard(found)
        return currentCards
      })
    }
  }, [isReadOnlyMode])

  // NOTE: we deliberately do NOT move a card into another column during dragOver.
  // Doing so unmounts/remounts the card in a different SortableContext on every
  // frame you hover a new column, which forces dnd-kit to re-register and
  // re-measure. The cause of the cross-column drag lag. Instead, the target
  // column's own `isOver` droppable highlight provides live feedback, the drag
  // overlay follows the cursor, and the actual move is committed once in
  // handleDragEnd. Within-column reordering still previews smoothly via dnd-kit's
  // built-in SortableContext transforms (no state churn).

  const handleDragCancel = useCallback(() => {
    setActiveDragCard(null)
    loadCards()
  }, [loadCards])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    if (isReadOnlyMode) return
    const { active, over } = event
    setActiveDragCard(null)

    if (!over || active.id === over.id) return

    const activeId = active.id as string
    const overId = over.id as string

    // Column reorder: ids are prefixed with "col::"
    if (activeId.startsWith('col::')) {
      const current = columnsRef.current
      const fromIdx = current.findIndex(c => `col::${c.id}` === activeId)
      const toIdx   = current.findIndex(c => `col::${c.id}` === overId)
      if (fromIdx === -1 || toIdx === -1) return
      await persistColumns(arrayMove(current, fromIdx, toIdx))
      return
    }

    // Card move / reorder
    const cardId = activeId
    let newStatus = overId
    const isColumnTarget = columns.some(c => c.id === overId)

    const draggedCard = cards.find(c => c.id === cardId)
    if (!draggedCard) return

    if (!isColumnTarget) {
      const targetCard = cards.find(c => c.id === overId)
      if (!targetCard) return
      newStatus = targetCard.status
    }

    // When swimlanes are enabled, sort visually (priority desc, position asc) so
    // overIndex matches the rendered order the user sees. Otherwise sort by position only.
    const destColumnCards = cards
      .filter(c => c.status === newStatus && c.id !== cardId)
      .sort(swimlanesEnabled
        ? (a, b) => b.priority !== a.priority ? b.priority - a.priority : a.position - b.position
        : (a, b) => a.position - b.position
      )

    let newPosition = 0
    // When swimlanes are on, also infer the target priority from neighboring cards
    let newPriority: 0 | 1 | 2 | 3 | undefined = undefined

    if (isColumnTarget) {
      newPosition = destColumnCards.length === 0
        ? 1000.0
        : destColumnCards[destColumnCards.length - 1].position + 1000.0
      if (swimlanesEnabled) {
        // Dropped on column header → inherit priority of the last card in the column, or keep existing
        newPriority = destColumnCards.length > 0
          ? destColumnCards[destColumnCards.length - 1].priority
          : draggedCard.priority
      }
    } else {
      const overIndex = destColumnCards.findIndex(c => c.id === overId)
      if (overIndex === 0) {
        newPosition = destColumnCards[0].position / 2.0
      } else if (overIndex === -1 || overIndex === destColumnCards.length) {
        newPosition = destColumnCards[destColumnCards.length - 1].position + 1000.0
      } else {
        const a = destColumnCards[overIndex - 1].position
        const b = destColumnCards[overIndex].position
        newPosition = (a + b) / 2.0
        if (Math.abs(a - b) < 0.00001) {
          const patch: Partial<Item> = { status: newStatus, position: newPosition }
          if (swimlanesEnabled) patch.priority = destColumnCards[overIndex].priority
          setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...patch } : c))
          await window.electronAPI.db.updateItem(cardId, patch)
          await window.electronAPI.db.rebalancePositions(activeContext, newStatus)
          loadCards()
          return
        }
      }

      // Infer priority from the card the user dropped onto (or the card before it)
      if (swimlanesEnabled) {
        const neighborCard = overIndex >= 0 && overIndex < destColumnCards.length
          ? destColumnCards[overIndex]
          : overIndex > 0
          ? destColumnCards[overIndex - 1]
          : undefined
        newPriority = neighborCard?.priority ?? draggedCard.priority
      }
    }

    const patch: Partial<Item> = { status: newStatus, position: newPosition }
    if (swimlanesEnabled && newPriority !== undefined) patch.priority = newPriority

    setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...patch } : c))
    try {
      await window.electronAPI.db.updateItem(cardId, patch)
    } catch (err) {
      console.error('Failed to update card position:', err)
      loadCards()
    }
  }, [cards, columns, swimlanesEnabled, activeContext, loadCards, persistColumns])

  // Column Management

  const handleCreateColumnSubmit = async (name: string, wipLimit: number | null, color?: string, colorMode?: 'header' | 'full', description?: string) => {
    const id = `col-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
    const updatedCols = [...columnsRef.current, { id, name, wipLimit, color, colorMode, description }]
    try {
      await persistColumns(updatedCols)
      setShowAddColModal(false)
      toast(`Column "${name}" created`)
    } catch (err) {
      console.error('Failed to create column:', err)
    }
  }

  const handleRenameColumn = useCallback(async (colId: string, newName: string, newWipLimit: number | null, color?: string, colorMode?: 'header' | 'full') => {
    const updatedCols = columnsRef.current.map(c => c.id === colId ? { ...c, name: newName, wipLimit: newWipLimit, color, colorMode } : c)
    await persistColumns(updatedCols)
    toast(`Column "${newName}" updated`)
  }, [persistColumns, toast])

  const performDeleteColumn = useCallback(async (colId: string) => {
    // Read the LATEST columns (via ref) so deleting two in a row can't operate on
    // a stale list and write back a column that was just removed.
    const current = columnsRef.current
    const colName = current.find(c => c.id === colId)?.name || 'Column'
    const updatedCols = current.filter(c => c.id !== colId)
    try {
      const cardsToMove = cards.filter(c => c.status === colId)
      if (cardsToMove.length > 0) {
        const fallbackColId = updatedCols[0]?.id ?? 'open'
        await window.electronAPI.db.bulkUpdateItems({
          ids: cardsToMove.map(c => c.id),
          patch: { status: fallbackColId }
        })
      }
      await persistColumns(updatedCols)
      setPendingDeleteColId(null)
      loadCards()
      toast(`Column "${colName}" deleted. Remaining cards moved.`)
    } catch (err) {
      console.error('Failed to delete column:', err)
    }
  }, [cards, persistColumns, loadCards, toast])

  const handleDeleteColumn = useCallback(async (colId: string) => {
    const cardsToMove = cards.filter(c => c.status === colId)
    if (cardsToMove.length > 0) {
      setPendingDeleteColId(colId)
    } else {
      await performDeleteColumn(colId)
    }
  }, [cards, performDeleteColumn])

  // Column sorting & bulk actions

  const handleClearColumnCards = useCallback(async (columnId: string) => {
    const colCards = cards.filter(c => c.status === columnId)
    if (colCards.length === 0) return

    try {
      await window.electronAPI.db.bulkUpdateItems({
        ids: colCards.map(c => c.id),
        patch: { status: 'archived' }
      })
      loadCards()
      toast(`Archived all cards in column`)
    } catch (err) {
      console.error(err)
    }
  }, [cards, loadCards, toast])

  const handleArchiveColumn = useCallback(async (colId: string) => {
    const current = columnsRef.current
    const colToArchive = current.find(c => c.id === colId)
    if (!colToArchive) return

    try {
      // Both halves in one patch: archiving moves a column between two lists,
      // and writing them separately left a window where the column existed in
      // neither if the second write failed.
      const updatedArchived = [...archivedColumns, colToArchive]
      const updatedCols = current.filter(c => c.id !== colId)
      columnsRef.current = updatedCols
      setColumns(updatedCols)
      setArchivedColumns(updatedArchived)
      await persistConfig({ columns: updatedCols, archivedColumns: updatedArchived })

      setArchivedColumns(updatedArchived)
      loadCards()
      toast(`Column "${colToArchive.name}" archived`)
    } catch (err) {
      console.error(err)
    }
  }, [activeContext, persistColumns, loadCards, toast])

  // Card Management

  const handleUpdateCardDetails = useCallback(async (id: string, patch: Partial<Item>, tagIds?: string[]) => {
    try {
      setCards(prev => prev.map(c => {
        if (c.id === id) {
          const updated = { ...c, ...patch }
          if (tagIds !== undefined) {
            updated.tags = allTags.filter(t => tagIds.includes(t.id))
          }
          return updated
        }
        return c
      }))
      await window.electronAPI.db.updateItem(id, patch, tagIds)
      loadCards()
    } catch (err) {
      console.error('Failed to update card details:', err)
    }
  }, [loadCards, allTags])

  const handleCardDelete = useCallback(async (id: string) => {
    try {
      const originalIndex = cards.findIndex(c => c.id === id)
      if (originalIndex === -1) return
      const targetCard = cards[originalIndex]
      await window.electronAPI.db.updateItem(id, { status: 'archived' })
      setCards(prev => prev.filter(c => c.id !== id))
      
      toast('Card archived.', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await window.electronAPI.db.updateItem(id, { status: targetCard.status })
              setCards(prev => {
                const updated = [...prev]
                updated.splice(originalIndex, 0, targetCard)
                return updated
              })
              toast('Card restored')
            } catch (err) {
              console.error('Failed to restore card:', err)
            }
          }
        }
      })
    } catch (err) {
      console.error('Failed to delete card:', err)
    }
  }, [cards, toast])

  const handleCardConvertToTask = useCallback(async (id: string) => {
    try {
      const targetCard = cards.find(c => c.id === id)
      await window.electronAPI.db.updateItem(id, { type: 'task', status: 'open' })
      setCards(prev => prev.filter(c => c.id !== id))
      toast(`Card "${targetCard?.title}" converted to Backlog Task`)
    } catch (err) {
      console.error('Failed to promote card to task:', err)
    }
  }, [cards, toast])

  const handleAddCardToColumn = useCallback(async (columnId: string) => {
    try {
      const colCards = cards.filter(c => c.status === columnId)
      const defaultPos = colCards.length > 0
        ? Math.max(...colCards.map(c => c.position)) + 1000.0
        : 1000.0
      const created = await window.electronAPI.db.createItem({
        type: 'card',
        context: activeContext,
        title: 'New card',
        body: '',
        status: columnId,
        priority: 0,
        position: defaultPos,
        due_at: null,
        metadata: '{}'
      })
      setCards(prev => [...prev, created])
      setActiveCardId(created.id)
    } catch (err) {
      console.error('Failed to create card:', err)
    }
  }, [cards, activeContext])

  // Quick add card to Backlog. Uses first column as fallback (not hardcoded 'open')
  const handleAddCardToBacklog = () => {
    const fallbackCol = columns[0]
    if (!fallbackCol) {
      toast('Add a column first before creating cards.', { type: 'info' })
      return
    }
    handleAddCardToColumn(fallbackCol.id)
  }

  // Template Instantiation
  const handleCreateCardFromTemplate = async (templateCard: Item) => {
    setShowTemplateSelector(false)
    try {
      const fallbackCol = columns[0]
      if (!fallbackCol) {
        toast('Add a column first.', { type: 'info' })
        return
      }
      
      const colId = columns.some(c => c.id === templateCard.status)
        ? templateCard.status
        : fallbackCol.id

      const colCards = cards.filter(c => c.status === colId)
      const defaultPos = colCards.length > 0
        ? Math.max(...colCards.map(c => c.position)) + 1000.0
        : 1000.0

      // Duplicate metadata but clear comments & activity log
      let originalMeta = {}
      try {
        originalMeta = JSON.parse(templateCard.metadata || '{}')
      } catch {}

      const cleanMeta = {
        ...originalMeta,
        isTemplate: false,
        comments: [],
        activities: [{ id: `act-${Date.now()}`, text: `Card created from template "${templateCard.title}"`, createdAt: Date.now() }]
      }

      const tagIds = templateCard.tags?.map(t => t.id) || []

      const created = await window.electronAPI.db.createItem({
        type: 'card',
        context: activeContext,
        title: `${templateCard.title} (Copy)`,
        body: templateCard.body,
        status: colId,
        priority: templateCard.priority,
        position: defaultPos,
        due_at: templateCard.due_at,
        metadata: JSON.stringify(cleanMeta)
      }, tagIds)

      setCards(prev => [...prev, created])
      setActiveCardId(created.id)
      toast(`Created card from template "${templateCard.title}"`)
    } catch (err) {
      console.error('Failed to create card from template:', err)
    }
  }

  // Archive Bin Restores
  const handleRestoreColumn = async (colId: string) => {
    const colToRestore = archivedColumns.find(c => c.id === colId)
    if (!colToRestore) return

    try {
      // One patch, for the same reason archiving is: a restore that half-failed
      // used to leave the column in both lists at once.
      const updatedCols = [...columns, colToRestore]
      const updatedArchived = archivedColumns.filter(c => c.id !== colId)
      columnsRef.current = updatedCols
      setColumns(updatedCols)
      setArchivedColumns(updatedArchived)
      await persistConfig({ columns: updatedCols, archivedColumns: updatedArchived })

      toast(`Column "${colToRestore.name}" restored`)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDeleteColumnPermanently = async (colId: string) => {
    const colName = archivedColumns.find(c => c.id === colId)?.name || 'Column'
    const confirmed = await confirm({
      title: 'Delete list permanently',
      message: `Permanently delete list "${colName}"? Any cards that belong to this list will remain archived.`,
      confirmText: 'Delete List',
      isDestructive: true
    })
    if (confirmed) {
      try {
        const updatedArchived = archivedColumns.filter(c => c.id !== colId)
        setArchivedColumns(updatedArchived)
        await persistConfig({ archivedColumns: updatedArchived })
        toast(`List "${colName}" deleted permanently`)
      } catch (err) {
        console.error(err)
      }
    }
  }

  const handleRestoreCard = async (cardId: string) => {
    const targetCard = cards.find(c => c.id === cardId)
    if (!targetCard) return

    const fallbackCol = columns[0]
    if (!fallbackCol) {
      toast('Add a column first to restore the card.', { type: 'info' })
      return
    }

    const destColId = columns.some(c => c.id === targetCard.status)
      ? targetCard.status
      : fallbackCol.id

    try {
      await window.electronAPI.db.updateItem(cardId, { status: destColId })
      loadCards()
      toast(`Card "${targetCard.title}" restored`)
    } catch (err) {
      console.error(err)
    }
  }

  // Archive Bin multi-select (bulk restore / delete)
  const toggleArchivedSelection = (id: string): void => {
    setSelectedArchived(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBulkDeleteArchived = async (): Promise<void> => {
    const ids = Array.from(selectedArchived)
    if (ids.length === 0) return
    const confirmed = await confirm({
      title: 'Delete archived cards',
      message: `Permanently delete ${ids.length} archived card${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true
    })
    if (!confirmed) return
    try {
      await Promise.all(ids.map(id => window.electronAPI.db.deleteItem(id)))
      setCards(prev => prev.filter(c => !selectedArchived.has(c.id)))
      setSelectedArchived(new Set())
      toast(`${ids.length} card${ids.length > 1 ? 's' : ''} deleted permanently`)
    } catch (err) {
      console.error(err)
      toast('Failed to delete some cards', { type: 'error' })
    }
  }

  const handleBulkRestoreArchived = async (): Promise<void> => {
    const ids = Array.from(selectedArchived)
    if (ids.length === 0) return
    const fallbackCol = columns[0]
    if (!fallbackCol) {
      toast('Add a column first to restore cards.', { type: 'info' })
      return
    }
    try {
      await Promise.all(ids.map(id => {
        const card = cards.find(c => c.id === id)
        const dest = card && columns.some(c => c.id === card.status) ? card.status : fallbackCol.id
        return window.electronAPI.db.updateItem(id, { status: dest })
      }))
      setSelectedArchived(new Set())
      loadCards()
      toast(`${ids.length} card${ids.length > 1 ? 's' : ''} restored`)
    } catch (err) {
      console.error(err)
      toast('Failed to restore some cards', { type: 'error' })
    }
  }

  // Clear any archive-bin selection whenever the drawer closes.
  useEffect(() => {
    if (!showArchiveBin) setSelectedArchived(new Set())
  }, [showArchiveBin])

  // Cards for a column, filtered and sorted appropriately
  // Group + filter + sort all cards into their columns in a SINGLE pass, memoized
  // on the inputs. Previously each column re-filtered the whole card list on every
  // render, so a drag (which calls setCards on each cross-column move) did O(columns
  // × cards) work per frame. The main source of drag lag. Now it's one pass, and
  // card object refs are preserved so the memoized columns only re-render when their
  // own cards actually change.
  const cardsByColumn = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const map = new Map<string, Item[]>()
    for (const c of cards) {
      if (c.status === 'archived') continue
      if (q && !(
        c.title.toLowerCase().includes(q) ||
        c.body.toLowerCase().includes(q) ||
        (c.tags && c.tags.some(t => t.name.toLowerCase().includes(q)))
      )) continue
      if (filterPriority !== -1 && c.priority !== filterPriority) continue
      if (filterTagId !== 'all' && !(c.tags && c.tags.some(t => t.id === filterTagId))) continue
      let arr = map.get(c.status)
      if (!arr) { arr = []; map.set(c.status, arr) }
      arr.push(c)
    }
    // Sorting stays inside this single pass. Applying a per-column order as a
    // second pass over the map would reintroduce the per-frame work this memo
    // exists to avoid during a drag.
    const byPosition = (a: Item, b: Item): number => a.position - b.position
    const byPriority = (a: Item, b: Item): number =>
      b.priority !== a.priority ? b.priority - a.priority : a.position - b.position
    // Cards with no due date sort last rather than reading as "due first".
    const byDue = (a: Item, b: Item): number => {
      if (!a.due_at && !b.due_at) return a.position - b.position
      if (!a.due_at) return 1
      if (!b.due_at) return -1
      return a.due_at - b.due_at || a.position - b.position
    }

    const sortModes = new Map(columns.map(c => [c.id, c.sort ?? 'manual']))
    for (const [colId, arr] of map) {
      // Swimlanes are a board-wide priority grouping and outrank a column's own
      // order; without that the two settings would visibly contradict.
      if (swimlanesEnabled) { arr.sort(byPriority); continue }
      const mode = sortModes.get(colId) ?? 'manual'
      arr.sort(mode === 'priority' ? byPriority : mode === 'due' ? byDue : byPosition)
    }
    return map
  }, [cards, searchQuery, filterPriority, filterTagId, swimlanesEnabled, columns])

  const getCardsForColumn = useCallback(
    (columnId: string): Item[] => cardsByColumn.get(columnId) || EMPTY_ITEMS,
    [cardsByColumn]
  )

  const templateCards = cards.filter(c => {
    try {
      const meta = JSON.parse(c.metadata || '{}')
      return meta.isTemplate === true
    } catch {
      return false
    }
  })

  // Loading skeleton view
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background)'
      }}>
        <header style={{
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--space-6)',
          borderBottom: '1px solid var(--color-surface-offset)',
          background: 'var(--color-surface-1)',
          flexShrink: 0
        }}>
          <Skeleton width={180} height={20} />
        </header>
        <div style={{
          flex: 1,
          padding: 'var(--space-5) var(--space-6)',
          display: 'flex',
          gap: 'var(--space-4)',
          overflowX: 'auto',
          overflowY: 'hidden',
          alignItems: 'stretch',
          height: 'calc(100% - 52px)'
        }}>
          {[1, 2, 3].map(colIdx => (
            <div key={colIdx} style={{
              width: '300px',
              minWidth: '280px',
              flex: '0 0 300px',
              background: 'var(--color-surface-1)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-surface-offset)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              height: '100%',
              boxSizing: 'border-box',
              flexShrink: 0
            }}>
              {/* Column Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)', flexShrink: 0 }}>
                <Skeleton width="50%" height={18} />
                <Skeleton width={20} height={18} borderRadius="var(--radius-sm)" />
              </div>
              
              {/* Column Accent Line */}
              <div style={{ height: '3px', background: 'var(--color-surface-offset)', borderRadius: '2px', flexShrink: 0 }} />

              {/* Cards Container */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', overflow: 'hidden' }}>
                {[1, 2, 3].map(cardIdx => (
                  <div key={cardIdx} style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)'
                  }}>
                    {/* Title block */}
                    <Skeleton width={`${80 - cardIdx * 10}%`} height={14} />
                    {/* Body blocks */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <Skeleton width="90%" height={10} />
                      <Skeleton width="45%" height={10} />
                    </div>
                    {/* Meta tag */}
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '4px' }}>
                      <Skeleton width={45} height={14} borderRadius="var(--radius-sm)" />
                      <Skeleton width={60} height={14} borderRadius="var(--radius-sm)" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const columnSortableIds = columns.map(c => `col::${c.id}`)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: getBoardBackgroundStyle(boardBg),
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Header Bar */}
      <header style={{
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-6)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h1 style={{
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            margin: 0,
            letterSpacing: 'var(--tracking-tight)'
          }}>
            Kanban Board
          </h1>
          <div style={{ position: 'relative' }} ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(v => !v)}
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-secondary)',
                background: 'var(--color-surface-2)',
                padding: '2px 10px',
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--color-surface-offset)',
                cursor: 'pointer',
                fontWeight: 'var(--weight-semibold)',
                transition: 'background var(--duration-fast), border-color var(--duration-fast)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--color-surface-offset)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--color-surface-2)'
              }}
            >
              #{contextsList.find(c => c.slug === activeContext)?.name || activeContext}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}>
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            
            {dropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  zIndex: 100,
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  minWidth: '180px',
                  padding: '4px 0',
                  animation: 'dropdown-in 150ms var(--ease-enter)'
                }}
              >
                {availableContexts.map(ctx => {
                  const entry = contextsList.find(c => c.slug === ctx)
                  const name = entry ? entry.name : ctx.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                  const color = entry ? entry.color : 'var(--color-balance)'
                  return (
                    <button
                      key={ctx}
                      onClick={() => {
                        setContext(ctx)
                        setDropdownOpen(false)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        width: '100%',
                        padding: '6px 12px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 'var(--text-sm)',
                        color: ctx === activeContext ? 'var(--color-secondary)' : 'var(--color-text-base)',
                        textAlign: 'left',
                        transition: 'background var(--duration-fast) var(--ease-default)'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: ctx === activeContext ? 'var(--color-secondary)' : color,
                        flexShrink: 0
                      }} />
                      {name}
                    </button>
                  )
                })}
                <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    width: '100%',
                    padding: '6px 12px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                    textAlign: 'left'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  onClick={() => {
                    setView('settings')
                    setSettingsTab('contexts')
                    setDropdownOpen(false)
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '2px', opacity: 0.7 }}>
                    <path d="M5 12h14M12 5v14"/>
                  </svg>
                  New Context
                </button>
              </div>
            )}
          </div>
          <span style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-faint)'
          }}>
            {cards.filter(c => c.status !== 'archived').length} active card{cards.filter(c => c.status !== 'archived').length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="row">
          {/* P2P Board Collaboration Share */}
          <div style={{ position: 'relative' }} ref={collabPopoverRef}>
            <HeaderBtn
              onClick={() => setShowCollabPopover(v => !v)}
              title="Collaborative P2P Workspace Board Sharing"
              icon={
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: collabActive ? 'var(--color-secondary)' : 'inherit' }}>
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              }
              active={showCollabPopover}
            >
              {collabActive ? (collabIsHost ? 'Hosting Live' : 'Joined Live') : 'Share'}
              {collabActive && (
                <span style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--color-secondary)',
                  marginLeft: '4px'
                }} />
              )}
            </HeaderBtn>

            {showCollabPopover && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  zIndex: 100,
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-xl)',
                  width: '280px',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                  animation: 'dropdown-in 150ms var(--ease-enter)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    P2P Workspace Sharing
                  </span>
                  {collabActive && (
                    <span style={{ fontSize: '10px', background: 'var(--color-secondary-muted)', color: 'var(--color-secondary)', padding: '2px 6px', borderRadius: 'var(--radius-full)', fontWeight: 'var(--weight-semibold)' }}>
                      Active
                    </span>
                  )}
                </div>

                {!collabActive ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {/* Host section */}
                    <div className="col">
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>Host Board Share</span>
                      <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>Let others join and view/edit this active card wall.</p>
                      
                      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '2px' }}>
                        <button
                          onClick={() => {
                            startCollabHosting('collaborative')
                          }}
                          style={{
                            flex: 1,
                            fontSize: 'var(--text-xs)',
                            fontWeight: 'var(--weight-semibold)',
                            background: 'var(--color-secondary-muted)',
                            color: 'var(--color-secondary)',
                            border: '1px solid var(--color-secondary)',
                            padding: '6px 0',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'var(--color-secondary)'
                            e.currentTarget.style.color = '#fff'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'var(--color-secondary-muted)'
                            e.currentTarget.style.color = 'var(--color-secondary)'
                          }}
                        >
                          Collaborative
                        </button>
                        <button
                          onClick={() => {
                            startCollabHosting('readonly')
                          }}
                          style={{
                            flex: 1,
                            fontSize: 'var(--text-xs)',
                            fontWeight: 'var(--weight-semibold)',
                            background: 'var(--color-surface-offset)',
                            color: 'var(--color-text-base)',
                            border: '1px solid var(--color-surface-offset)',
                            padding: '6px 0',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'var(--color-surface-offset)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'transparent'
                          }}
                        >
                          Read-Only
                        </button>
                      </div>
                    </div>

                    <div style={{ height: '1px', background: 'var(--color-surface-offset)' }} />

                    {/* Join section */}
                    <div className="col">
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>Join Shared Board</span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <input
                          type="text"
                          maxLength={6}
                          placeholder="Passcode (e.g. 123456)"
                          value={joinCodeInput}
                          onChange={e => setJoinCodeInput(e.target.value.replace(/\D/g, ''))}
                          style={{
                            flex: 1,
                            background: 'var(--color-surface-offset)',
                            border: '1px solid var(--color-surface-offset)',
                            borderRadius: 'var(--radius-md)',
                            padding: '4px 8px',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-base)',
                            outline: 'none'
                          }}
                        />
                        <button
                          onClick={() => {
                            joinCollabSession(joinCodeInput)
                          }}
                          disabled={joinCodeInput.length < 5}
                          style={{
                            fontSize: 'var(--text-xs)',
                            fontWeight: 'var(--weight-semibold)',
                            background: joinCodeInput.length < 5 ? 'var(--color-surface-offset)' : 'var(--color-secondary)',
                            color: joinCodeInput.length < 5 ? 'var(--color-text-muted)' : '#fff',
                            border: 'none',
                            padding: '0 var(--space-3)',
                            borderRadius: 'var(--radius-md)',
                            cursor: joinCodeInput.length < 5 ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Join
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {/* Active session state */}
                    <div style={{ background: 'var(--color-surface-offset)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <div className="row-between">
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Role:</span>
                        <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                          {collabIsHost ? `Host (${collabMode === 'readonly' ? 'Read-Only' : 'Collaborative'})` : 'Client'}
                        </span>
                      </div>
                      
                      {collabCode && (
                        <div className="row-between">
                          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Passcode:</span>
                          <span
                            onClick={() => {
                              navigator.clipboard.writeText(collabCode)
                              toast('Passcode copied to clipboard')
                            }}
                            style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 'var(--weight-bold)', color: 'var(--color-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                            title="Click to copy passcode"
                          >
                            {collabCode}
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                          </span>
                        </div>
                      )}

                      <div style={{ height: '1px', background: 'var(--color-surface-1)', margin: '4px 0' }} />

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>Status Logs:</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {collabProgress}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={disconnectCollab}
                      style={{
                        width: '100%',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                        background: 'var(--color-destructive-muted)',
                        color: 'var(--color-destructive)',
                        border: '1px solid var(--color-destructive)',
                        padding: '6px 0',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'var(--color-destructive)'
                        e.currentTarget.style.color = '#fff'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'var(--color-destructive-muted)'
                        e.currentTarget.style.color = 'var(--color-destructive)'
                      }}
                    >
                      Disconnect Share
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Background Theme Customizer */}
          <div style={{ position: 'relative' }} ref={bgSelectorRef}>
            <HeaderBtn
              onClick={() => setShowBgSelector(v => !v)}
              title="Change board background theme"
              icon={
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/>
                  <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>
                  <path d="M12 2v2M12 20v2M20 12h2M2 12h2"/>
                </svg>
              }
              active={showBgSelector}
            >
              Theme
            </HeaderBtn>
            
            {showBgSelector && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  zIndex: 100,
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-xl)',
                  width: '290px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                    Board Theme
                  </span>
                </div>

                {/* Sub-tabs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2px', background: 'var(--color-surface-2)', padding: '2px', borderRadius: 'var(--radius-md)' }}>
                  <button
                    onClick={() => setCustomBgTab('presets')}
                    style={{
                      padding: '4px 0',
                      fontSize: '9px',
                      fontWeight: 'var(--weight-semibold)',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: customBgTab === 'presets' ? 'var(--color-surface-offset)' : 'transparent',
                      color: customBgTab === 'presets' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Presets
                  </button>
                  <button
                    onClick={() => setCustomBgTab('solid')}
                    style={{
                      padding: '4px 0',
                      fontSize: '9px',
                      fontWeight: 'var(--weight-semibold)',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: customBgTab === 'solid' ? 'var(--color-surface-offset)' : 'transparent',
                      color: customBgTab === 'solid' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Solid
                  </button>
                  <button
                    onClick={() => setCustomBgTab('gradient')}
                    style={{
                      padding: '4px 0',
                      fontSize: '9px',
                      fontWeight: 'var(--weight-semibold)',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: customBgTab === 'gradient' ? 'var(--color-surface-offset)' : 'transparent',
                      color: customBgTab === 'gradient' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Gradient
                  </button>
                  <button
                    onClick={() => setCustomBgTab('image')}
                    style={{
                      padding: '4px 0',
                      fontSize: '9px',
                      fontWeight: 'var(--weight-semibold)',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: customBgTab === 'image' ? 'var(--color-surface-offset)' : 'transparent',
                      color: customBgTab === 'image' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Wallpaper
                  </button>
                </div>

                {/* TAB 1: PRESETS */}
                {customBgTab === 'presets' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '2px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                      {Object.keys(BG_STYLES).map(key => {
                        const isSel = boardBg === key
                        const styleVal = BG_STYLES[key]
                        return (
                          <button
                            key={key}
                            onClick={async () => {
                              setBoardBg(key)
                              setShowBgSelector(false)
                              try {
                                await persistConfig({ background: key })
                              } catch {}
                            }}
                            style={{
                              height: '32px',
                              borderRadius: 'var(--radius-md)',
                              border: isSel ? '2px solid var(--color-secondary)' : '1px solid var(--color-surface-offset)',
                              background: styleVal,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              fontWeight: 'var(--weight-bold)',
                              color: '#fff',
                              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                              textTransform: 'capitalize',
                              boxShadow: isSel ? '0 0 8px var(--color-secondary)50' : 'none'
                            }}
                          >
                            {key}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* TAB 2: SOLID COLOR */}
                {customBgTab === 'solid' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div
                      id="kanban-solid-bg-preview"
                      style={{
                        height: '40px',
                        borderRadius: 'var(--radius-md)',
                        background: customSolidColor,
                        border: '1px solid var(--color-surface-offset)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: '10px',
                        fontWeight: 'var(--weight-bold)',
                        textShadow: '0 1px 2px rgba(0,0,0,0.6)'
                      }}
                    >
                      {customSolidColor.toUpperCase()}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                      <ColorPicker
                        value={customSolidColor}
                        onLiveDomUpdate={col => {
                          const preview = document.getElementById('kanban-solid-bg-preview')
                          if (preview) {
                            preview.style.backgroundColor = col
                            preview.innerText = col.toUpperCase()
                          }
                        }}
                        onCommit={col => {
                          if (col) setCustomSolidColor(col)
                        }}
                        swatchSize={28}
                        hexInputWidth={80}
                        title="Choose Custom Board Color"
                      />
                    </div>

                    <button
                      onClick={async () => {
                        setBoardBg(customSolidColor)
                        setShowBgSelector(false)
                        try {
                          await persistConfig({ background: customSolidColor })
                        } catch {}
                      }}
                      style={{
                        padding: '7px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-secondary)',
                        color: '#0f172a',
                        fontWeight: 'var(--weight-bold)',
                        fontSize: '11px',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'center',
                        marginTop: '2px'
                      }}
                    >
                      Apply Solid Color
                    </button>
                  </div>
                )}

                {/* TAB 3: CUSTOM GRADIENT (WITH ANGLE & DIRECTION EDITING) */}
                {customBgTab === 'gradient' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {(() => {
                      const gradStr = customGradType === 'radial'
                        ? `radial-gradient(circle, ${customGradStart} 0%, ${customGradEnd} 100%)`
                        : `linear-gradient(${customGradAngle}deg, ${customGradStart} 0%, ${customGradEnd} 100%)`
                      return (
                        <>
                          <div
                            id="kanban-gradient-bg-preview"
                            style={{
                              height: '44px',
                              borderRadius: 'var(--radius-md)',
                              background: gradStr,
                              border: '1px solid var(--color-surface-offset)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#fff',
                              fontSize: '10px',
                              fontWeight: 'var(--weight-bold)',
                              textShadow: '0 1px 2px rgba(0,0,0,0.7)'
                            }}
                          >
                            Gradient Preview
                          </div>

                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                              <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Start Color</span>
                              <ColorPicker
                                value={customGradStart}
                                onLiveDomUpdate={col => {
                                  const preview = document.getElementById('kanban-gradient-bg-preview')
                                  if (preview) {
                                    const str = customGradType === 'radial'
                                      ? `radial-gradient(circle, ${col} 0%, ${customGradEnd} 100%)`
                                      : `linear-gradient(${customGradAngle}deg, ${col} 0%, ${customGradEnd} 100%)`
                                    preview.style.background = str
                                  }
                                }}
                                onCommit={col => {
                                  if (col) setCustomGradStart(col)
                                }}
                                swatchSize={22}
                                hexInputWidth={64}
                                title="Start Gradient Color"
                              />
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                              <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>End Color</span>
                              <ColorPicker
                                value={customGradEnd}
                                onLiveDomUpdate={col => {
                                  const preview = document.getElementById('kanban-gradient-bg-preview')
                                  if (preview) {
                                    const str = customGradType === 'radial'
                                      ? `radial-gradient(circle, ${customGradStart} 0%, ${col} 100%)`
                                      : `linear-gradient(${customGradAngle}deg, ${customGradStart} 0%, ${col} 100%)`
                                    preview.style.background = str
                                  }
                                }}
                                onCommit={col => {
                                  if (col) setCustomGradEnd(col)
                                }}
                                swatchSize={22}
                                hexInputWidth={64}
                                title="End Gradient Color"
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                            <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Gradient Style</span>
                            <div style={{ display: 'flex', gap: '4px', background: 'var(--color-surface-2)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
                              <button
                                onClick={() => setCustomGradType('linear')}
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '10px',
                                  border: 'none',
                                  borderRadius: '2px',
                                  background: customGradType === 'linear' ? 'var(--color-surface-offset)' : 'transparent',
                                  color: customGradType === 'linear' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                                  cursor: 'pointer'
                                }}
                              >
                                Linear
                              </button>
                              <button
                                onClick={() => setCustomGradType('radial')}
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '10px',
                                  border: 'none',
                                  borderRadius: '2px',
                                  background: customGradType === 'radial' ? 'var(--color-surface-offset)' : 'transparent',
                                  color: customGradType === 'radial' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                                  cursor: 'pointer'
                                }}
                              >
                                Radial
                              </button>
                            </div>
                          </div>

                          {customGradType === 'linear' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-muted)' }}>
                                <span>Angle / Direction</span>
                                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-secondary)', fontWeight: 'bold' }}>{customGradAngle}°</span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="360"
                                value={customGradAngle}
                                onChange={e => setCustomGradAngle(Number(e.target.value))}
                                style={{ width: '100%', accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
                              />
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', marginTop: '2px' }}>
                                {[0, 90, 135, 180].map(ang => (
                                  <button
                                    key={ang}
                                    onClick={() => setCustomGradAngle(ang)}
                                    style={{
                                      padding: '2px 0',
                                      fontSize: '9px',
                                      borderRadius: '3px',
                                      border: '1px solid var(--color-surface-offset)',
                                      background: customGradAngle === ang ? 'var(--color-surface-offset)' : 'transparent',
                                      color: customGradAngle === ang ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    {ang}°
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          <button
                            onClick={async () => {
                              setBoardBg(gradStr)
                              setShowBgSelector(false)
                              try {
                                await persistConfig({ background: gradStr })
                              } catch {}
                            }}
                            style={{
                              padding: '7px',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--color-secondary)',
                              color: '#0f172a',
                              fontWeight: 'var(--weight-bold)',
                              fontSize: '11px',
                              border: 'none',
                              cursor: 'pointer',
                              textAlign: 'center',
                              marginTop: '2px'
                            }}
                          >
                            Apply Gradient
                          </button>
                        </>
                      )
                    })()}
                  </div>
                )}

                {/* TAB 3: CUSTOM IMAGE (FILE UPLOAD OR URL) */}
                {customBgTab === 'image' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleFileUpload}
                    />

                    {/* Upload File Button / Drop Zone */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-surface-2)',
                        border: '1px dashed var(--color-surface-offset)',
                        color: 'var(--color-text-base)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        fontWeight: 'var(--weight-semibold)',
                        transition: 'all 120ms ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-surface-offset)'}
                    >
                      <Upload size={18} style={{ color: 'var(--color-secondary)' }} />
                      <span>Upload Image from Computer</span>
                      <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>PNG, JPG, WEBP, GIF (Max 8MB)</span>
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '2px 0' }}>
                      <div style={{ flex: 1, height: '1px', background: 'var(--color-surface-offset)' }} />
                      <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>OR PASTE LINK</span>
                      <div style={{ flex: 1, height: '1px', background: 'var(--color-surface-offset)' }} />
                    </div>

                    <input
                      type="text"
                      placeholder="Paste image URL (https://...)"
                      value={customImageUrl.startsWith('data:') ? '[Uploaded Local File]' : customImageUrl}
                      onChange={e => setCustomImageUrl(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: '11px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        color: 'var(--color-text-base)'
                      }}
                    />

                    {customImageUrl.trim() && (
                      <div style={{
                        height: '60px',
                        borderRadius: 'var(--radius-md)',
                        background: `url("${customImageUrl.trim()}") center / cover no-repeat`,
                        border: '1px solid var(--color-surface-offset)',
                        position: 'relative',
                        overflow: 'hidden'
                      }}>
                        <span style={{ position: 'absolute', bottom: '4px', right: '6px', fontSize: '9px', background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: '4px', color: '#fff' }}>Preview</span>
                      </div>
                    )}

                    <button
                      disabled={!customImageUrl.trim()}
                      onClick={async () => {
                        if (!customImageUrl.trim()) return
                        const imgVal = customImageUrl.trim()
                        setBoardBg(imgVal)
                        setShowBgSelector(false)
                        try {
                          await persistConfig({ background: imgVal })
                        } catch {}
                      }}
                      style={{
                        padding: '7px',
                        borderRadius: 'var(--radius-md)',
                        background: customImageUrl.trim() ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
                        color: customImageUrl.trim() ? '#0f172a' : 'var(--color-text-muted)',
                        fontWeight: 'var(--weight-bold)',
                        fontSize: '11px',
                        border: 'none',
                        cursor: customImageUrl.trim() ? 'pointer' : 'not-allowed',
                        textAlign: 'center',
                        marginTop: '2px'
                      }}
                    >
                      Apply Wallpaper
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Archive Bin side drawer button */}
          <HeaderBtn
            onClick={() => setShowArchiveBin(true)}
            title="View archived cards and lists"
            icon={
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="5" x="2" y="3" rx="1"/>
                <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>
              </svg>
            }
            active={showArchiveBin}
          >
            Archive Bin
          </HeaderBtn>

          {/* Swimlanes toggle */}
          <HeaderBtn
            active={swimlanesEnabled}
            onClick={async () => {
              const next = !swimlanesEnabled
              setSwimlanesEnabled(next)
              await persistConfig({ swimlanes: next })
            }}
            title="Toggle priority swimlanes"
            icon={swimlanesEnabled ? <Layers size={13} /> : <LayoutGrid size={13} />}
          >
            {swimlanesEnabled ? 'Priority View' : 'Flat Board'}
          </HeaderBtn>

          {/* Card face toggles. What each card shows */}
          <div style={{ position: 'relative' }} ref={cardDisplayRef}>
            <HeaderBtn
              active={showCardDisplayMenu}
              onClick={() => setShowCardDisplayMenu(v => !v)}
              title="Choose what appears on each card"
              icon={<Eye size={13} />}
            >
              Card Fields
            </HeaderBtn>
            {showCardDisplayMenu && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 60,
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                padding: 'var(--space-2)',
                minWidth: '190px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                {CARD_DISPLAY_FIELDS.map(field => (
                  <label
                    key={field.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-1-5) var(--space-2)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-base)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={cardDisplay[field.key]}
                      onChange={e => {
                        const next = { ...cardDisplay, [field.key]: e.target.checked }
                        setCardDisplay(next)
                        persistConfig({ cardDisplay: next })
                      }}
                      style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
                    />
                    {field.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* From Template Dropdown */}
          {templateCards.length > 0 && (
            <div style={{ position: 'relative' }} ref={templateSelectorRef}>
              <HeaderBtn
                onClick={() => setShowTemplateSelector(v => !v)}
                title="Create card from a reusable template"
                icon={
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2"/>
                    <path d="M9 17h6M9 13h6M9 9h6"/>
                  </svg>
                }
                active={showTemplateSelector}
              >
                From Template
              </HeaderBtn>
              
              {showTemplateSelector && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    right: 0,
                    zIndex: 100,
                    background: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-md)',
                    minWidth: '220px',
                    padding: '4px 0'
                  }}
                >
                  <span style={{ display: 'block', fontSize: '9px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase', padding: '6px 12px 4px' }}>
                    Select Template
                  </span>
                  {templateCards.map(tc => (
                    <button
                      key={tc.id}
                      onClick={() => handleCreateCardFromTemplate(tc)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '6px 12px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-base)',
                        textAlign: 'left'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      {tc.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add Column */}
          {!isReadOnlyMode && (
            <HeaderBtn
              onClick={() => setShowAddColModal(true)}
              title="Add a new column"
              icon={<Plus size={13} />}
            >
              Add Column
            </HeaderBtn>
          )}

          {/* Add Card (primary CTA) */}
          {!isReadOnlyMode && (
            <button
              id="kanban-add-card"
              onClick={handleAddCardToBacklog}
              style={{
                background: 'var(--color-secondary)',
                border: 'none',
                color: 'var(--color-text-inverted)',
                borderRadius: 'var(--radius-md)',
                padding: '0 var(--space-4)',
                height: '32px',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-bold)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1-5)',
                letterSpacing: '0.01em',
                transition: 'filter 100ms ease, transform 100ms ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.12)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.transform = 'none' }}
            >
              <Plus size={13} strokeWidth={2.5} />
              New Card
            </button>
          )}
        </div>
      </header>

      {/* Real-Time Filter Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px var(--space-6)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)90',
        backdropFilter: 'blur(8px)',
        flexShrink: 0,
        gap: 'var(--space-4)',
        flexWrap: 'wrap'
      }}>
        {/* Search Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
          <input
            type="text"
            placeholder="Search cards (title, body, tag)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: '5px 10px',
              fontSize: 'var(--text-xs)',
              outline: 'none',
              transition: 'border-color var(--duration-fast)'
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--color-secondary)')}
            onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
          />
        </div>

        {/* Filters Group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          {/* Priority filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>Priority:</span>
            <select
              value={filterPriority}
              onChange={e => setFilterPriority(parseInt(e.target.value))}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: '3px 6px',
                fontSize: 'var(--text-xs)',
                outline: 'none'
              }}
            >
              <option value={-1}>All</option>
              <option value={3}>High</option>
              <option value={2}>Medium</option>
              <option value={1}>Low</option>
              <option value={0}>None</option>
            </select>
          </div>

          {/* Tag filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>Tag:</span>
            <select
              value={filterTagId}
              onChange={e => setFilterTagId(e.target.value)}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: '3px 6px',
                fontSize: 'var(--text-xs)',
                outline: 'none',
                maxWidth: '120px'
              }}
            >
              <option value="all">All</option>
              {allTags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>

          {/* Reset Filters button */}
          {(searchQuery || filterPriority !== -1 || filterTagId !== 'all') && (
            <button
              onClick={() => { setSearchQuery(''); setFilterPriority(-1); setFilterTagId('all') }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-secondary)',
                fontSize: '11px',
                cursor: 'pointer',
                fontWeight: 'var(--weight-bold)',
                padding: '2px 4px'
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Board Area */}
      {columns.length === 0 ? (
        <div style={{ flex: 1 }}>
          <EmptyState
            icon={<KanbanSquare size={48} />}
            title="No Columns Defined"
            description="Your Kanban board needs columns to structure your workflow tasks."
            actionLabel="Add Columns"
            onActionClick={() => setShowAddColModal(true)}
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          measuring={{
            droppable: {
              strategy: MeasuringStrategy.WhileDragging
            }
          }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {/* Column-level sortable context (for column reordering) */}
          <SortableContext items={columnSortableIds} strategy={horizontalListSortingStrategy}>
            <div style={{
              flex: 1,
              padding: 'var(--space-5) var(--space-6)',
              display: 'flex',
              gap: 'var(--space-4)',
              overflowX: 'auto',
              overflowY: 'hidden',
              alignItems: 'stretch',
              height: 'calc(100% - 98px)', // Adjusted for header (52px) + filter toolbar (46px)
              minHeight: 0
            }}>
              {columns.map(col => (
                <SortableColumn
                  key={col.id}
                  col={col}
                  cards={getCardsForColumn(col.id)}
                  onRename={handleRenameColumn}
                  onDelete={handleDeleteColumn}
                  onCardClick={setActiveCardId}
                  onCardDelete={handleCardDelete}
                  onCardConvertToTask={handleCardConvertToTask}
                  onAddCard={handleAddCardToColumn}
                  onCardUpdate={handleUpdateCardDetails}
                  onClearColumn={handleClearColumnCards}
                  onArchiveColumn={handleArchiveColumn}
                  isReadOnly={isReadOnlyMode}
                  onToggleCollapse={handleToggleCollapse}
                  onSetSort={handleSetColumnSort}
                  cardDisplay={cardDisplay}
                />
              ))}

              {/* Ghost "Add Column" tile at end */}
              {!isReadOnlyMode && (
                <button
                  onClick={() => setShowAddColModal(true)}
                  style={{
                    width: '280px',
                    minWidth: '260px',
                    flexShrink: 0,
                    height: '100%',
                    background: 'transparent',
                    border: '2px dashed var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    color: 'var(--color-text-faint)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-medium)',
                    transition: 'border-color 150ms ease, color 150ms ease, background 150ms ease'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--color-balance)'
                    e.currentTarget.style.color = 'var(--color-text-muted)'
                    e.currentTarget.style.background = 'var(--color-surface-1)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
                    e.currentTarget.style.color = 'var(--color-text-faint)'
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <Plus size={20} strokeWidth={1.5} />
                  Add Column
                </button>
              )}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeDragCard ? (
              <div style={{ transform: 'rotate(2deg)', width: '280px', pointerEvents: 'none' }}>
                <KanbanCard
                  card={activeDragCard}
                  onClick={() => {}}
                  onDelete={() => {}}
                  onConvertToTask={() => {}}
                  isOverlay
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Archive Bin Drawer */}
      {showArchiveBin && (
        <div
          ref={archiveBinRef}
          role="dialog"
          aria-modal="true"
          aria-label="Archive bin"
          onClick={() => setShowArchiveBin(false)}
          style={{
            position: 'fixed',
            top: '32px',
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 850,
            display: 'flex',
            justifyContent: 'flex-end',
            backdropFilter: 'blur(1px)'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '320px',
              maxWidth: '100vw',
              height: '100%',
              background: 'var(--color-surface-1)',
              borderLeft: '1px solid var(--color-surface-offset)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
              animation: 'slide-in 0.25s cubic-bezier(0.32, 0.72, 0, 1)'
            }}
          >
            {/* Header */}
            <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--color-surface-offset)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                Archive Bin
              </span>
              <button
                onClick={() => setShowArchiveBin(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '18px' }}
              >
                ×
              </button>
            </div>

            {/* Content list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              
              {/* Archived Columns List */}
              <div className="col">
                <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                  Archived Columns ({archivedColumns.length})
                </span>
                {archivedColumns.map(col => (
                  <div
                    key={col.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)'
                    }}
                  >
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                      {col.name}
                    </span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => handleRestoreColumn(col.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', fontSize: '10px', cursor: 'pointer', fontWeight: 'var(--weight-semibold)' }}
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => handleDeleteColumnPermanently(col.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--color-error)', fontSize: '10px', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {archivedColumns.length === 0 && (
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No archived columns.</span>
                )}
              </div>

              {/* Archived Cards List */}
              {(() => {
                const archivedCards = cards.filter(c => c.status === 'archived')
                const allSelected = archivedCards.length > 0 && archivedCards.every(c => selectedArchived.has(c.id))
                const selCount = archivedCards.reduce((n, c) => n + (selectedArchived.has(c.id) ? 1 : 0), 0)
                return (
                  <div className="col">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                        Archived Cards ({archivedCards.length})
                      </span>
                      {archivedCards.length > 0 && (
                        <button
                          onClick={() => setSelectedArchived(allSelected ? new Set() : new Set(archivedCards.map(c => c.id)))}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-primary)', fontSize: '10px', cursor: 'pointer', fontWeight: 'var(--weight-semibold)' }}
                        >
                          {allSelected ? 'Clear' : 'Select all'}
                        </button>
                      )}
                    </div>

                    {/* Bulk action bar. Appears when items are selected */}
                    {selCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'var(--color-primary-muted)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', padding: '6px 10px' }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', fontWeight: 'var(--weight-semibold)' }}>
                          {selCount} selected
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            onClick={handleBulkRestoreArchived}
                            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', color: 'var(--color-secondary)', fontSize: '10px', fontWeight: 'var(--weight-semibold)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '3px 10px' }}
                          >
                            Restore
                          </button>
                          <button
                            onClick={handleBulkDeleteArchived}
                            style={{ background: 'var(--color-error)', border: 'none', color: '#fff', fontSize: '10px', fontWeight: 'var(--weight-bold)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '3px 10px' }}
                          >
                            Delete ({selCount})
                          </button>
                        </div>
                      </div>
                    )}

                    {archivedCards.map(card => {
                      const selected = selectedArchived.has(card.id)
                      return (
                        <div
                          key={card.id}
                          onClick={() => toggleArchivedSelection(card.id)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            background: selected ? 'var(--color-primary-muted)' : 'var(--color-surface-2)',
                            border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-surface-offset)'}`,
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <span
                              aria-hidden
                              style={{
                                width: '15px', height: '15px', flexShrink: 0, borderRadius: '4px',
                                border: `1.5px solid ${selected ? 'var(--color-primary)' : 'var(--color-balance)'}`,
                                background: selected ? 'var(--color-primary)' : 'transparent',
                                color: '#fff', fontSize: '10px', lineHeight: '13px', textAlign: 'center', fontWeight: 'bold'
                              }}
                            >
                              {selected ? '✓' : ''}
                            </span>
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', fontWeight: 'var(--weight-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={card.title}>
                              {card.title}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                              onClick={e => { e.stopPropagation(); handleRestoreCard(card.id) }}
                              style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', fontSize: '10px', cursor: 'pointer', fontWeight: 'var(--weight-semibold)' }}
                            >
                              Restore
                            </button>
                            <button
                              onClick={async e => {
                                e.stopPropagation()
                                const confirmed = await confirm({
                                  title: 'Delete card permanently',
                                  message: `Permanently delete card "${card.title}"? This cannot be undone.`,
                                  confirmText: 'Delete',
                                  isDestructive: true
                                })
                                if (confirmed) {
                                  try {
                                    await window.electronAPI.db.deleteItem(card.id)
                                    setCards(prev => prev.filter(c => c.id !== card.id))
                                    setSelectedArchived(prev => { const n = new Set(prev); n.delete(card.id); return n })
                                    toast('Card deleted permanently')
                                  } catch (err) {
                                    console.error(err)
                                  }
                                }
                              }}
                              style={{ background: 'transparent', border: 'none', color: 'var(--color-error)', fontSize: '10px', cursor: 'pointer' }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    {archivedCards.length === 0 && (
                      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No archived cards.</span>
                    )}
                  </div>
                )
              })()}

            </div>
          </div>
        </div>
      )}


      {/* Card Detail Modal */}
      {activeCardId && (
        <CardDetailModal
          cardId={activeCardId}
          initialCard={cards.find(c => c.id === activeCardId)}
          columns={columns}
          onClose={() => setActiveCardId(null)}
          onUpdate={handleUpdateCardDetails}
          isReadOnly={isReadOnlyMode}
        />
      )}

      {/* Add Column Modal */}
      {showAddColModal && (
        <AddColumnModal
          onClose={() => setShowAddColModal(false)}
          onSubmit={handleCreateColumnSubmit}
          existingNames={columns.map(c => c.name)}
        />
      )}

      {/* Column Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={pendingDeleteColId !== null}
        title="Confirm Column Deletion"
        message="Are you sure you want to delete this column? Any cards inside this column will be moved to the open backlog."
        confirmText="Delete Column"
        cancelText="Cancel"
        isDestructive={true}
        onConfirm={() => pendingDeleteColId && performDeleteColumn(pendingDeleteColId)}
        onCancel={() => setPendingDeleteColId(null)}
      />
    </div>
  )
}

// Header Button component
function HeaderBtn({
  children,
  onClick,
  title,
  icon,
  active = false
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  icon: React.ReactNode
  active?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: active
          ? 'var(--color-secondary-muted)'
          : hover ? 'var(--color-surface-2)' : 'transparent',
        border: active
          ? '1px solid var(--color-secondary)'
          : '1px solid var(--color-surface-offset)',
        color: active
          ? 'var(--color-secondary)'
          : hover ? 'var(--color-text-base)' : 'var(--color-text-muted)',
        borderRadius: 'var(--radius-md)',
        padding: '0 var(--space-3)',
        height: '32px',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-medium)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1-5)',
        transition: 'background 100ms ease, border-color 100ms ease, color 100ms ease',
        whiteSpace: 'nowrap'
      }}
    >
      {icon}
      {children}
    </button>
  )
}
