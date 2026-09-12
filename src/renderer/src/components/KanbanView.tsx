import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Tag } from '../../../shared/types'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  rectIntersection,
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
import ConfirmDialog, { useConfirm, usePick } from './ui/ConfirmDialog'
import useFocusTrap from './ui/useFocusTrap'
import useEscapeKey from './ui/useEscapeKey'
import EmptyState from './ui/EmptyState'
import { useToast } from './ui/Toast'
import ColorPicker from './ui/ColorPicker'
import {
  loadBoardConfig,
  patchBoardConfig,
  DEFAULT_CARD_DISPLAY,
  sameCardDisplay,
  sameColumnConfig,
  type BoardConfig,
  type CardDisplay,
  type ColumnConfig,
  type ColumnSort
} from '../lib/boardConfig'
import { describeImpact, type MergeImpact } from '../../../shared/boardMerge'
import {
  dropIndex,
  dropTargetAt,
  lastCardIn,
  positionForIndex,
  type CardBox,
  type ColumnBox,
  type DropTarget
} from '../../../shared/cardDrop'
import { availableWorkspaceSlug, occupiedWorkspaces, setWorkspaceShared } from '../lib/createWorkspace'
import { authorLabel, DISPLAY_NAME_KEY, DISPLAY_NAME_MAX, normalizeDisplayName } from '../../../shared/identity'
import { WebRTCCollaborationCoordinator } from '../lib/webrtcCollaboration'
import { errorMessage } from '../../../shared/errors'
import { getTextColorForBackground } from '../lib/contrast'
import { writeWorkspaceList } from '../lib/workspaceList'
import { getStringSetting, setStringSetting } from '../lib/settings'
import { listTags } from '../data/tags'
import { readItems } from '../data/items'
import MenuItem, { MenuDivider, MenuPanel } from './ui/MenuItem'


// Re-exported rather than declared: the shape now belongs to lib/boardConfig,
// which owns the whole board document. Kept as an export so existing importers
// of ColumnConfig from this module keep working.
export type { ColumnConfig }

/** The card face fields a board can switch on and off. */
const CARD_DISPLAY_FIELDS: { key: keyof CardDisplay; label: string }[] = [
  { key: 'priority', label: 'Priority Bar' },
  { key: 'tags', label: 'Tags' },
  { key: 'due', label: 'Due Date' },
  { key: 'bodyPreview', label: 'Body Preview' },
  { key: 'cover', label: 'Cover' },
  { key: 'checklist', label: 'Checklist Progress' },
  { key: 'template', label: 'Template Badge' },
  { key: 'doneCheckbox', label: 'Done Checkbox' }
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

/**
 * What the collision detector needs to know that the rectangles do not say:
 * which droppables are columns, which are cards and whose column each card is
 * in.
 *
 * Worked out from the board's own state rather than from the ids, because the
 * ids do not carry it. Columns register under their own id and cards under
 * theirs, but so does each column's sortable, under a `col::` id, and reading
 * "not a column id" as "a card" is what silently sent every drop to the end of
 * the first column.
 */
interface DropGeometry {
  /** Column id to whether a drop can pick a slot in it rather than just land in it. */
  columns: Map<string, boolean>
  cardColumn: Map<string, string>
}

/**
 * Whether a drop can pick a slot in a column or only land in it.
 *
 * A column sorted by priority or due date decides its own order, so a slot
 * picked in one is a slot the card would not keep. Swimlanes override a
 * column's own sort with a priority grouping, and a lane is very much worth
 * aiming at: dropping into one is how a card's priority gets set.
 *
 * Read by the collision detector and by the column that draws the gap. Written
 * out twice they could disagree, and then the gap is drawn somewhere the card
 * is not going to land.
 */
function canAimAtSlot(column: ColumnConfig, swimlanes: boolean): boolean {
  return swimlanes || (column.sort ?? 'manual') === 'manual'
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
  /** Where the drop preview sits, as an index into `cards`. null for nowhere. */
  dropSlot?: number | null
  /** The height the dragged card had, so the gap is the footprint it will take. */
  dropHeight?: number
}

function areSortableColumnPropsEqual(prev: SortableColumnProps, next: SortableColumnProps) {
  if (prev.isReadOnly !== next.isReadOnly) return false
  // The board hands these down only while a card is in the air, and only the
  // column under the pointer gets a slot, so this is what keeps a drag to one
  // re-rendering column instead of all of them.
  if (prev.dropSlot !== next.dropSlot || prev.dropHeight !== next.dropHeight) return false
  // Whole-object compares. The five fields this used to name by hand left
  // collapsed, sort, description and cardDisplay out, so those changes were
  // dropped here and never reached a card.
  if (!sameColumnConfig(prev.col, next.col)) return false
  if (!sameCardDisplay(prev.cardDisplay, next.cardDisplay)) return false
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
  cardDisplay,
  dropSlot = null,
  dropHeight
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
        dropSlot={dropSlot}
        dropHeight={dropHeight}
      />
    </div>
  )
}, areSortableColumnPropsEqual)

export default function KanbanView() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const availableWorkspaces = useAppStore(s => s.availableWorkspaces)
  const workspaceList = useAppStore(s => s.workspaceList)
  const setWorkspaceList = useAppStore(s => s.setWorkspaceList)
  const setWorkspace = useAppStore(s => s.setWorkspace)
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
  const pick = usePick()

  /**
   * Kept as typed and normalised on the way out, so the field is not fighting
   * the caret. Empty is a real answer: the account name stands in for it.
   */
  const [displayName, setDisplayName] = useState('')
  const osUserName = normalizeDisplayName(window.electronAPI.app.osUserName)

  /** False until the stored name has arrived, so loading it does not write it back. */
  const nameLoaded = useRef(false)

  useEffect(() => {
    getStringSetting(DISPLAY_NAME_KEY, '')
      .then(raw => setDisplayName(normalizeDisplayName(raw)))
      .catch(err => console.error('Failed to read the display name:', err))
      .finally(() => { nameLoaded.current = true })
  }, [])

  /**
   * Saved as it is typed rather than on blur.
   *
   * The popover closes on mousedown, which unmounts the field before focus
   * moves, so no blur is ever delivered and a name typed and then clicked away
   * from was silently lost. This effect lives on the view, not the popover, so
   * it survives the close and writes anyway.
   */
  useEffect(() => {
    if (!nameLoaded.current) return
    const timer = setTimeout(() => {
      const name = normalizeDisplayName(displayName)
      setStringSetting(DISPLAY_NAME_KEY, name)
        .catch(err => console.error('Failed to save the display name:', err))
      // The room is holding the name read when the session started, so without
      // this a rename reaches nobody until the next connection.
      void collabCoordinatorRef.current?.rename(name)
    }, 400)
    return () => clearTimeout(timer)
  }, [displayName])

  /** Tidies what is in the field once the user has finished with it. */
  const saveDisplayName = useCallback(() => {
    setDisplayName(current => normalizeDisplayName(current))
  }, [])

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
  /**
   * Whether this side may write the board document.
   *
   * A ref because the persistence layer is defined above the collaboration
   * state it depends on, and written during render rather than in an effect so
   * it is never a frame behind the permission it stands for.
   */
  const readOnlyRef = useRef(false)

  const persistColumns = useCallback(async (next: ColumnConfig[]): Promise<void> => {
    // The board document travels between peers now, so a guest with no right to
    // change the board has no right to change this either.
    if (readOnlyRef.current) return
    columnsRef.current = next
    setColumns(next)
    try {
      await patchBoardConfig(activeWorkspace, { columns: next })
    } catch (err) {
      console.error('Failed to persist columns:', err)
    }
  }, [activeWorkspace])

  /** Writes any other slice of the board document; state is set by the caller. */
  const persistConfig = useCallback(async (patch: Partial<BoardConfig>): Promise<void> => {
    if (readOnlyRef.current) return
    try {
      await patchBoardConfig(activeWorkspace, patch)
    } catch (err) {
      console.error('Failed to persist board config:', err)
    }
  }, [activeWorkspace])

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
  /**
   * Where the card in the air would land.
   *
   * State on the board rather than each column reading the drag context for
   * itself. The context's value changes on every pointer move, so every column
   * on the board re-rendered on every frame of every drag just to work out that
   * nothing about it had changed. This changes when the target changes, which
   * during a whole drag is a handful of times.
   */
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  /** The height the dragged card had before it was picked up. */
  const [dragHeight, setDragHeight] = useState(0)
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
  /**
   * Everyone in the room, as they call themselves.
   *
   * The host keeps this from its own connections; a guest is told it, because
   * guests are connected to the host and not to each other. A member with an
   * empty name is on a build that does not introduce itself, and is still very
   * much in the room.
   */
  const [collabRoster, setCollabRoster] = useState<{ id: string; name: string }[]>([])
  const [collabProgress, setCollabProgress] = useState('Idle')
  const [showCollabPopover, setShowCollabPopover] = useState(false)
  const [joinCodeInput, setJoinCodeInput] = useState('')

  const collabCoordinatorRef = useRef<WebRTCCollaborationCoordinator | null>(null)
  const collabPopoverRef = useRef<HTMLDivElement>(null)

  const isReadOnlyMode = collabActive && collabMode === 'readonly' && !collabIsHost
  readOnlyRef.current = isReadOnlyMode

  /**
   * Whether to take the board the other side has merged for the two of you.
   *
   * Put with numbers on it. "Do you want to merge" is not a question anybody
   * can answer, and saying yes to it overwrites a board.
   */
  const considerMerge = useCallback(async ({ by, impact }: { by: string; impact: MergeImpact }) => {
    const what = describeImpact(impact)
    const them = by || 'They'
    const back = impact.cardsReturning
    const gone = impact.cardsRemoved
    // Both of these are the merge costing this board something, and the warning
    // is the only line that says so.
    const warnings: string[] = []
    if (gone > 0) {
      warnings.push(
        `${gone} card${gone === 1 ? '' : 's'} you have would be taken away, because ` +
          `${by || 'they'} deleted ${gone === 1 ? 'it' : 'them'}.`
      )
    }
    if (back > 0) {
      warnings.push(
        `${back} card${back === 1 ? '' : 's'} you deleted would come back, because they still ` +
          `have ${back === 1 ? 'it' : 'them'}.`
      )
    }
    return confirm({
      title: by ? `${by} wants to merge your boards` : 'Merge the two boards?',
      message: what
        ? `${them} merged their copy of this board with yours and is offering the result: ` +
          `${what}. Taking it makes it the board everyone here is on.`
        : `${them} merged their copy of this board with yours. Nothing here would change.`,
      confirmText: 'Merge',
      cancelText: 'Keep mine',
      isDestructive: gone > 0,
      warning: warnings.length > 0 ? warnings.join(' ') : undefined
    })
  }, [confirm])

  /**
   * What the host did with the merge this side offered.
   *
   * A no ends the session, which the coordinator is doing as this runs: this
   * board is now the merged one and the room is still on the host's, and a
   * guest holding cards the room does not have loses them the moment the host
   * takes anybody else's merge. So the panel is closed here too.
   */
  const reportMergeAnswer = useCallback((accepted: boolean, by: string, reason: string) => {
    const them = by || 'They'
    if (accepted) {
      setCollabProgress(`${them} took the merge. Both boards now match.`)
      return
    }
    const why = reason
      ? `The merge was not taken: ${reason}. Your board is merged and sharing has ended.`
      : `${them} kept their own board. Your board is merged and sharing has ended.`
    setCollabProgress(why)
    setCollabActive(false)
    setCollabRoster([])
    // Said out loud as well. The board just changed under this user and the
    // panel it would otherwise be said in is usually shut.
    toast(why)
  }, [toast])

  /** The host took somebody's merge, and this is the shared board now. */
  const reportBoardReset = useCallback((by: string) => {
    const said = by
      ? `${by} merged their board in. The shared board has been updated.`
      : 'The shared board has been merged and updated.'
    setCollabProgress(said)
    toast(said)
  }, [toast])

  const startCollabHosting = useCallback(async (mode: 'collaborative' | 'readonly') => {
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    setCollabActive(true)
    setCollabIsHost(true)
    setCollabCode(code)
    setCollabMode(mode)
    setCollabWorkspace(activeWorkspace)
    setCollabProgress('Initializing host signal room...')

    // Labelled here rather than when a peer actually arrives: publishing a
    // passcode is the moment the board stops being private, whether or not
    // anybody takes it up.
    const labelled = setWorkspaceShared(workspaceList, activeWorkspace, true)
    if (labelled !== workspaceList) {
      setWorkspaceList(labelled)
      writeWorkspaceList(labelled)
        .catch(err => console.error('Failed to record the workspace as shared:', err))
    }

    const coord = new WebRTCCollaborationCoordinator({
      pairingCode: code,
      isHost: true,
      context: activeWorkspace,
      mode,
      onProgress: (p) => setCollabProgress(p),
      onConnect: () => setCollabProgress('Someone joined.'),
      // Toasted as well as logged. A session that ends by itself used to do it
      // in silence: the button went back to saying Share and the reason sat in
      // a popover nobody had open, so the only thing anyone could report was
      // that sharing had stopped working.
      onDisconnect: () => {
        setCollabProgress('Peer disconnected.')
        setCollabActive(false)
        toast('Sharing stopped: the connection closed')
      },
      onError: (err) => {
        setCollabProgress(`Error: ${errorMessage(err)}`)
        setCollabActive(false)
        toast(`Sharing stopped: ${errorMessage(err)}`)
      },
      displayName,
      onRoster: setCollabRoster,
      // The host is the only side asked about a merge, and the only side that
      // never offers one, so there is no answer coming back here.
      onMergeProposed: considerMerge,
      // One guest going does not end the session: the passcode still works and
      // everyone else is still here.
      onPeerLeft: (name) => {
        setCollabProgress(`${authorLabel(name)} left. The same passcode still works.`)
      },
      // The host keeps its own board and never receives a baseline.
      onResolveBaseline: async () => ({ action: 'replace' })
    })
    collabCoordinatorRef.current = coord
    await coord.start()
  }, [activeWorkspace, workspaceList, setWorkspaceList, displayName, considerMerge, toast])

  const joinCollabSession = useCallback(async (code: string) => {
    if (!code || code.length < 5) return
    setCollabActive(true)
    setCollabIsHost(false)
    // Cleared, not left as it was. Hosting read-only and then joining someone
    // else's board carried that over, and until the host's board arrived to say
    // otherwise it locked this user out of their own.
    setCollabMode('collaborative')
    setCollabCode(code)
    setCollabWorkspace(activeWorkspace)
    setCollabProgress('Initiating connection...')

    const coord = new WebRTCCollaborationCoordinator({
      pairingCode: code,
      isHost: false,
      context: activeWorkspace,
      mode: 'collaborative', // Client infers mode from baseline message
      displayName,
      onProgress: (p) => setCollabProgress(p),
      onConnect: () => setCollabProgress('Connected to the host.'),
      onDisconnect: () => {
        setCollabProgress('Host disconnected.')
        setCollabActive(false)
        setCollabRoster([])
        toast('Sharing stopped: the host closed the connection')
      },
      onError: (err) => {
        setCollabProgress(`Error: ${errorMessage(err)}`)
        setCollabActive(false)
        toast(`Sharing stopped: ${errorMessage(err)}`)
      },
      onRoster: setCollabRoster,
      onMergeProposed: considerMerge,
      onMergeAnswer: reportMergeAnswer,
      onBoardReset: reportBoardReset,
      // The host's word on what this side may do, and it can change mid-session.
      onMode: setCollabMode,
      onRemoved: (by) => {
        const said = by ? `${by} removed you from the board` : 'You were removed from the board'
        setCollabProgress(`${said}.`)
        setCollabActive(false)
        setCollabRoster([])
        toast(said)
      },
      onResolveBaseline: async ({ context, incomingItems, mode }) => {
        // A check that could not run is not permission to delete, so a failed
        // read is treated as a clash and the user is asked anyway.
        let taken: Set<string>
        try {
          taken = await occupiedWorkspaces()
        } catch (err) {
          console.error('Could not check for an existing workspace:', err)
          taken = new Set([context])
        }
        // Nothing here under that name, so nothing to lose and nothing to ask.
        if (!taken.has(context)) {
          setCollabWorkspace(context)
          return { action: 'replace' }
        }

        const copySlug = availableWorkspaceSlug(context, taken)
        // Three answers, each of which needs a sentence to be understood. A row
        // of buttons can hold the labels but not the sentences, and picking
        // between "Replace mine" and "Keep both" on the labels alone is how
        // someone deletes a board they meant to keep.
        const choice = await pick({
          title: `You already have "${context}"`,
          message:
            `They are sharing a board called "${context}" with ${incomingItems} item(s), ` +
            `and you have a board of your own under that name.`,
          cancelText: 'Cancel',
          choices: [
            // Not on offer when the board is shared read-only. A merge ends
            // with the host holding the board the two of you make, and a host
            // sharing read-only has said the guests do not change this board,
            // so the offer would only ever be turned down.
            ...(mode === 'readonly'
              ? []
              : [
                  {
                    key: 'merge',
                    label: 'Merge the two',
                    detail:
                      'Keeps everything from both copies. A card you both have keeps what each ' +
                      'of you wrote on it, and anything you deleted stays deleted.'
                  }
                ]),
            {
              key: 'copy',
              label: 'Keep them apart',
              detail: `Puts their board in "${copySlug}" and leaves yours exactly as it is.`
            },
            {
              key: 'replace',
              label: 'Replace mine',
              detail:
                'Deletes every card and task you have under that name and takes theirs instead. ' +
                'This cannot be undone.',
              isDestructive: true
            }
          ]
        })
        // The session belongs to whichever workspace the board actually lands in,
        // which for a copy is not the name the host used.
        if (choice === 'merge') {
          setCollabWorkspace(context)
          return { action: 'merge' }
        }
        if (choice === 'replace') {
          setCollabWorkspace(context)
          return { action: 'replace' }
        }
        if (choice === 'copy') {
          setCollabWorkspace(copySlug)
          return { action: 'copy', slug: copySlug }
        }
        return { action: 'cancel' }
      }
    })
    collabCoordinatorRef.current = coord
    await coord.start()
  }, [activeWorkspace, pick, displayName, considerMerge, reportMergeAnswer, reportBoardReset, toast])

  /**
   * The workspace the live session belongs to.
   *
   * Switching workspace leaves the session running against the one you left,
   * which is correct (the other side agreed to share that board, not this one)
   * but looked like a dead connection: nothing synced and the panel still said
   * Active. Holding the slug lets the panel say so, and offer the way back.
   */
  const [collabWorkspace, setCollabWorkspace] = useState('')
  const collabElsewhere = collabActive && collabWorkspace !== '' && collabWorkspace !== activeWorkspace

  const disconnectCollab = useCallback(() => {
    if (collabCoordinatorRef.current) {
      // Announced before hanging up, so the other side is told who left rather
      // than watching the connection go quiet. Best effort, never blocking.
      void collabCoordinatorRef.current.leave()
      collabCoordinatorRef.current = null
    }
    setCollabActive(false)
    setCollabIsHost(false)
    setCollabCode('')
    setCollabWorkspace('')
    setCollabRoster([])
    setCollabProgress('Disconnected')
  }, [])

  /**
   * Shows one person the door, and leaves everyone else where they are.
   *
   * Their client will not come back on its own, but the passcode they hold
   * still works, so this is a door rather than a lock. Changing the passcode is
   * the lock, and it is separate because it removes everybody.
   */
  const removeCollabGuest = useCallback(async (member: { id: string; name: string }) => {
    const coord = collabCoordinatorRef.current
    if (!coord) return

    const who = authorLabel(member.name)
    const confirmed = await confirm({
      title: `Remove ${who}?`,
      message:
        'They lose access straight away and their app will not reconnect on its own. ' +
        'Everyone else stays. The passcode does not change, so use Change passcode ' +
        'if you want it to stop working for them for good.',
      confirmText: 'Remove',
      isDestructive: true
    })
    if (!confirmed) return

    await coord.remove(member.id)
    setCollabProgress(`Removed ${who}.`)
  }, [confirm])

  /**
   * A new passcode, which is the only thing that really locks anyone out.
   *
   * Everybody has to rejoin, so it is deliberately its own action rather than
   * something removing one person does on the quiet.
   */
  const rotateCollabCode = useCallback(async () => {
    const coord = collabCoordinatorRef.current
    if (!coord) return
    // Rehosting starts from the workspace on screen, so doing this from a board
    // that is not the shared one would quietly share that one instead.
    if (collabElsewhere) return

    const confirmed = await confirm({
      title: 'Change the passcode?',
      message:
        'Everyone connected is disconnected and the old passcode stops working. ' +
        'Your board stays shared: give the new one to whoever should still be here.',
      confirmText: 'Change it',
      isDestructive: true
    })
    if (!confirmed) return

    await coord.leave()
    collabCoordinatorRef.current = null
    setCollabRoster([])
    await startCollabHosting(collabMode)
    setCollabProgress('The passcode has changed. Everyone needs the new one.')
  }, [collabMode, collabElsewhere, confirm, startCollabHosting])

  /** Lets the guest write, or stops them, without ending the session. */
  const setCollabGuestMode = useCallback(async (mode: 'collaborative' | 'readonly') => {
    setCollabMode(mode)
    try {
      await collabCoordinatorRef.current?.setMode(mode)
    } catch (err) {
      console.error('Failed to tell the peer about the mode change:', err)
    }
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
      const config = await loadBoardConfig(activeWorkspace)
      setColumns(config.columns)
      setSwimlanesEnabled(config.swimlanes)
      setBoardBg(config.background)
      setArchivedColumns(config.archivedColumns)
      setCardDisplay(config.cardDisplay)
    } catch (err) {
      console.error('Failed to load Kanban column settings:', err)
    }
  }, [activeWorkspace])

  const loadCards = useCallback(async () => {
    try {
      setCards(await readItems(activeWorkspace, 'card'))
    } catch (err) {
      console.error('Failed to load Kanban cards:', err)
    }
  }, [activeWorkspace])

  const loadTags = useCallback(async () => {
    try {
      const tags = await listTags()
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

  // Cards for a column, filtered and sorted appropriately
  // Group + filter + sort all cards into their columns in a SINGLE pass, memoized
  // on the inputs. Previously each column re-filtered the whole card list on every
  // render, and a drag renders the board repeatedly, so that was O(columns × cards)
  // per frame. The main source of drag lag. Now it's one pass, and card object refs
  // are preserved so the memoized columns only re-render when their own cards
  // actually change.
  //
  // It sits above the drag handlers because it is the order the user is looking
  // at, and that is the order a drop has to be worked out against.
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

  // Drag & Drop

  /**
   * Kept in a ref because the collision detector runs on every pointer move and
   * must not be rebuilt under the drag each time a card changes.
   */
  const dropGeometryRef = useRef<DropGeometry>({ columns: new Map(), cardColumn: new Map() })
  useEffect(() => {
    const columnOrder = new Map<string, boolean>()
    for (const col of columns) columnOrder.set(col.id, canAimAtSlot(col, swimlanesEnabled))
    const cardColumn = new Map<string, string>()
    for (const card of cards) cardColumn.set(card.id, card.status)
    dropGeometryRef.current = { columns: columnOrder, cardColumn }
  }, [columns, cards, swimlanesEnabled])

  /**
   * Which droppable the card in the air is aimed at.
   *
   * dnd-kit's own detectors answer "which rectangle is the pointer inside", and
   * the gaps between cards are inside no card at all, so a pointer resting in
   * one fell through to the column, and the column means the end of the list.
   * That is the jump to the bottom. This asks the question the user is actually
   * asking, which card would I end up above, and cardDrop answers it against
   * the midpoints, so a gap belongs to the card either side of it.
   */
  const collisionDetection = useCallback<CollisionDetection>(args => {
    // Dragging a column is a different gesture with different targets: the
    // other columns, hit by the dragged column's own rectangle.
    if (String(args.active.id).startsWith('col::')) return rectIntersection(args)

    // The keyboard sensor moves a rectangle rather than a pointer, so its
    // centre stands in for one and the same rules apply.
    const point = args.pointerCoordinates ?? {
      x: args.collisionRect.left + args.collisionRect.width / 2,
      y: args.collisionRect.top + args.collisionRect.height / 2
    }

    const { columns: columnOrder, cardColumn } = dropGeometryRef.current
    const columnBoxes: ColumnBox[] = []
    const cardBoxes: CardBox[] = []
    for (const container of args.droppableContainers) {
      const rect = container.rect.current
      if (!rect) continue
      const id = String(container.id)
      if (columnOrder.has(id)) {
        columnBoxes.push({ id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
        continue
      }
      // Anything that is neither a known column nor a known card is left alone
      // rather than guessed at. Each column registers a sortable of its own
      // under a `col::` id, and reading those as cards is what once sent every
      // drop to the end of the first column.
      const column = cardColumn.get(id)
      if (column) cardBoxes.push({ id, column, top: rect.top, height: rect.height })
    }

    const target = dropTargetAt(columnBoxes, cardBoxes, point)
    if (!target) return []
    if (columnOrder.get(target.column) !== true) return [{ id: target.column }]

    // Past the last card of the card's own column. dnd-kit can only preview a
    // move onto another card, so naming the column here parts nothing and the
    // drag looks dead. Aiming at the bottom card says the same thing: with this
    // card lifted out of the list, taking the bottom card's slot is the end of
    // it. A column holding nothing but the dragged card names the card itself,
    // which is the drag that changes nothing.
    const before = target.before ?? (
      cardColumn.get(String(args.active.id)) === target.column
        ? lastCardIn(cardBoxes, target.column)
        : null
    )
    return [{ id: before ?? target.column }]
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (isReadOnlyMode) return
    const { active } = event
    const id = active.id as string
    if (id.startsWith('col::')) return
    setCards(currentCards => {
      const found = currentCards.find(c => c.id === id)
      if (found) setActiveDragCard(found)
      return currentCards
    })
    // Read here because the card is about to be lifted out of the layout, and
    // the gap held open for it should be the footprint it will really take.
    setDragHeight(active.rect.current.initial?.height ?? 0)
  }, [isReadOnlyMode])

  /**
   * Where the card would land, not a move of it.
   *
   * Actually moving the card into the hovered column here is what the board
   * used to do, and it unmounted and remounted the card in a different
   * SortableContext every time, which is what made a cross-column drag crawl.
   * dnd-kit calls this only when the target changes, so noting the target costs
   * one render per target rather than one per frame, and the column draws the
   * gap for itself. Reordering inside a column still previews through dnd-kit's
   * own sortable transforms.
   */
  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (isReadOnlyMode) return
    const { active, over } = event
    if (String(active.id).startsWith('col::')) return
    if (!over) {
      setDropTarget(null)
      return
    }
    const overId = String(over.id)
    const { columns: columnOrder, cardColumn } = dropGeometryRef.current
    if (columnOrder.has(overId)) {
      setDropTarget({ column: overId, before: null })
      return
    }
    const column = cardColumn.get(overId)
    setDropTarget(column ? { column, before: overId } : null)
  }, [isReadOnlyMode])

  const endDrag = useCallback(() => {
    setActiveDragCard(null)
    setDropTarget(null)
  }, [])

  const handleDragCancel = useCallback(() => {
    endDrag()
    loadCards()
  }, [endDrag, loadCards])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    // Before the read-only check, because the overlay and the gap have to be
    // put away whether or not the drop is allowed to land.
    endDrag()
    if (isReadOnlyMode) return
    const { active, over } = event

    if (!over || active.id === over.id) return

    const activeId = String(active.id)
    const overId = String(over.id)

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
    const draggedCard = cards.find(c => c.id === cardId)
    if (!draggedCard) return

    const isColumnTarget = columns.some(c => c.id === overId)
    const newStatus = isColumnTarget ? overId : cards.find(c => c.id === overId)?.status
    if (!newStatus) return

    // The destination column in the order the user is looking at. The gap was
    // drawn into this same list, so working the position out from any other
    // order is how a card ends up somewhere other than where the gap was.
    const order = cardsByColumn.get(newStatus) ?? EMPTY_ITEMS
    const rest = order.filter(c => c.id !== cardId)
    const index = dropIndex(order.map(c => c.id), cardId, isColumnTarget ? null : overId)
    const newPosition = positionForIndex(rest.map(c => c.position), index)

    // Swimlanes group the whole board by priority, so which lane a card is
    // dropped into is a choice of priority as much as a choice of place.
    const neighbour = rest[index] ?? rest[index - 1]
    const newPriority = swimlanesEnabled ? (neighbour?.priority ?? draggedCard.priority) : undefined

    // A null position means the cards either side of the gap already hold
    // numbers with nothing between them. Take the lower one and renumber the
    // column, which is the only thing that makes room.
    const needsRebalance = newPosition === null
    const patch: Partial<Item> = {
      status: newStatus,
      position: newPosition ?? rest[index].position
    }
    if (newPriority !== undefined) patch.priority = newPriority

    setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...patch } : c))
    try {
      await window.electronAPI.db.updateItem(cardId, patch)
      if (needsRebalance) {
        await window.electronAPI.db.rebalancePositions(activeWorkspace, newStatus)
        loadCards()
      }
    } catch (err) {
      console.error('Failed to update card position:', err)
      loadCards()
    }
  }, [cards, cardsByColumn, columns, swimlanesEnabled, activeWorkspace, loadCards, persistColumns, endDrag, isReadOnlyMode])

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
  }, [activeWorkspace, persistColumns, loadCards, toast])

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
        context: activeWorkspace,
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
  }, [cards, activeWorkspace])

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
        context: activeWorkspace,
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
      <header className="kanban-header" style={{
        // Not a fixed height. Everything inside is nowrap now, so it never
        // needs to grow, but a hard 52px was what let the wrapped text spill
        // out of the bar rather than being clipped by it.
        minHeight: '52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: '0 var(--space-6)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)',
        flexShrink: 0
      }}>
        {/* minWidth 0 so this side is what gives way when the bar is narrow.
            Without it a flex child refuses to shrink below its content and
            pushes the buttons off the right edge instead. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
          <h1 className="kanban-header-title" style={{
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            margin: 0,
            letterSpacing: 'var(--tracking-tight)',
            whiteSpace: 'nowrap',
            flexShrink: 0
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
                gap: '4px',
                // A workspace can be called anything. Truncated rather than
                // wrapped, which turned a chip into a three-line block.
                maxWidth: '190px',
                minWidth: 0,
                whiteSpace: 'nowrap'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--color-surface-offset)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--color-surface-2)'
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                #{workspaceList.find(c => c.slug === activeWorkspace)?.name || activeWorkspace}
              </span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}>
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            
            {dropdownOpen && (
              <MenuPanel>
                {availableWorkspaces.map(ctx => {
                  const entry = workspaceList.find(c => c.slug === ctx)
                  const name = entry ? entry.name : ctx.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                  const color = entry ? entry.color : 'var(--color-balance)'
                  return (
                    <button
                      key={ctx}
                      onClick={() => {
                        setWorkspace(ctx)
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
                        color: ctx === activeWorkspace ? 'var(--color-secondary)' : 'var(--color-text-base)',
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
                        background: ctx === activeWorkspace ? 'var(--color-secondary)' : color,
                        flexShrink: 0
                      }} />
                      {name}
                    </button>
                  )
                })}
                <MenuDivider />
                <MenuItem
                  onClick={() => {
                    setView('settings')
                    setSettingsTab('workspaces')
                    setDropdownOpen(false)
                  }}
                >
                  New Workspace
                </MenuItem>
              </MenuPanel>
            )}
          </div>
          <span className="kanban-card-count" style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-faint)',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}>
            {cards.filter(c => c.status !== 'archived').length} active card{cards.filter(c => c.status !== 'archived').length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Never shrinks. A button pushed past the right edge is a button
            nobody can press, and this row has gone over it before. */}
        <div className="row" style={{ flexShrink: 0 }}>
          {/* P2P Board Collaboration Share */}
          <div style={{ position: 'relative' }} ref={collabPopoverRef}>
            <HeaderBtn
              onClick={() => setShowCollabPopover(v => !v)}
              title="Share this board with someone else"
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
                    Share This Board
                  </span>
                  {collabActive && (
                    <span style={{
                      fontSize: '10px',
                      background: collabElsewhere ? 'var(--color-warning-muted)' : 'var(--color-secondary-muted)',
                      color: collabElsewhere ? 'var(--color-warning)' : 'var(--color-secondary)',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-full)',
                      fontWeight: 'var(--weight-semibold)'
                    }}>
                      {collabElsewhere ? 'Elsewhere' : 'Active'}
                    </span>
                  )}
                </div>

                {/* The session belongs to the workspace it was started in and
                    stays there when you move, so nothing you do here is shared
                    and nothing they do shows up. It said Active throughout,
                    which read exactly like a dead connection. */}
                {collabElsewhere && (
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--color-warning)',
                    background: 'var(--color-warning-muted)',
                    border: '1px solid var(--color-warning)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2) var(--space-3)',
                    lineHeight: 1.4
                  }}>
                    You are sharing <strong>#{collabWorkspace}</strong>, not the board you are looking
                    at. Nothing here is being shared.
                    <button
                      onClick={() => {
                        setWorkspace(collabWorkspace)
                        setShowCollabPopover(false)
                      }}
                      style={{
                        display: 'block',
                        marginTop: '6px',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        font: 'inherit',
                        color: 'var(--color-warning)',
                        cursor: 'pointer',
                        textDecoration: 'underline'
                      }}
                    >
                      Go back to #{collabWorkspace}
                    </button>
                  </div>
                )}

                {!collabActive ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {/* Who you are, once, for both hosting and joining. Card
                        history credits this name, so it is worth setting before
                        a board is shared rather than after. */}
                    <div className="col">
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>Your Name</span>
                      <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>
                        Shown against your changes on a shared board.
                        {osUserName && ` Left empty, changes are credited to ${osUserName}.`}
                      </p>
                      <input
                        value={displayName}
                        maxLength={DISPLAY_NAME_MAX}
                        onChange={e => setDisplayName(e.target.value)}
                        onBlur={saveDisplayName}
                        // The fallback rather than an invented example, so the
                        // empty field shows what it will actually do.
                        placeholder={osUserName || 'e.g. Dimitris'}
                        style={{
                          marginTop: '2px',
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-base)',
                          fontSize: 'var(--text-xs)',
                          padding: '6px var(--space-2)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    {/* Host section */}
                    <div className="col">
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>Invite Someone</span>
                      <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>Give another person this board to read or edit, live, while you both have it open.</p>
                      
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
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>Join Someone's Board</span>
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

                    {/* The two features are one word apart and were being
                        mistaken for each other. Each now says what it is not
                        and where the other one lives. */}
                    <p style={{
                      fontSize: '11px',
                      color: 'var(--color-text-faint)',
                      margin: 0,
                      paddingTop: 'var(--space-2)',
                      borderTop: '1px solid var(--color-surface-offset)',
                      lineHeight: 1.4
                    }}>
                      This is for another person, and covers this board only. To keep your own
                      machines in step, use{' '}
                      <button
                        onClick={() => {
                          setShowCollabPopover(false)
                          setView('settings')
                          setSettingsTab('sync')
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          font: 'inherit',
                          color: 'var(--color-secondary)',
                          cursor: 'pointer',
                          textDecoration: 'underline'
                        }}
                      >
                        Device Sync
                      </button>.
                    </p>
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

                      {/* Who is in the room. The session used to report only
                          that somebody was, which is no basis for deciding
                          whether they should stay. */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                          {collabIsHost
                            ? `In this board (${collabRoster.length})`
                            : `Also here (${collabRoster.length})`}
                        </span>
                        {collabRoster.length === 0 ? (
                          <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
                            Nobody yet
                          </span>
                        ) : (
                          collabRoster.map(member => (
                            <div key={member.id} className="row-between" style={{ gap: 'var(--space-2)' }}>
                              <span style={{
                                fontSize: '11px',
                                fontWeight: 'var(--weight-semibold)',
                                color: 'var(--color-text-base)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}>
                                {authorLabel(member.name)}
                              </span>
                              {/* Removing is the host's, and not from a board
                                  it is not looking at. */}
                              {collabIsHost && !collabElsewhere && (
                                <button
                                  onClick={() => removeCollabGuest(member)}
                                  title={`Remove ${authorLabel(member.name)}`}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: '0 2px',
                                    fontSize: '10px',
                                    fontWeight: 'var(--weight-semibold)',
                                    color: 'var(--color-text-faint)',
                                    cursor: 'pointer',
                                    flexShrink: 0
                                  }}
                                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-warning)')}
                                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-faint)')}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                      <div style={{ height: '1px', background: 'var(--color-surface-1)', margin: '4px 0' }} />

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>Status Logs:</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {collabProgress}
                        </span>
                      </div>
                    </div>

                    {/* What the host can do about the person in the room. Only
                        the host, and only while someone is in it. */}
                    {collabIsHost && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        <button
                          onClick={() => setCollabGuestMode(collabMode === 'readonly' ? 'collaborative' : 'readonly')}
                          title={collabMode === 'readonly'
                            ? 'Let them make changes to the board'
                            : 'Let them look, but not change anything'}
                          style={{
                            width: '100%',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 'var(--weight-semibold)',
                            background: 'transparent',
                            color: 'var(--color-text-base)',
                            border: '1px solid var(--color-surface-offset)',
                            padding: '6px 0',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            transition: 'border-color var(--duration-fast) var(--ease-default)'
                          }}
                          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-secondary)')}
                          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
                        >
                          {collabMode === 'readonly' ? 'Let them edit' : 'Make it read-only'}
                        </button>

                        {!collabElsewhere && (
                          <button
                            onClick={rotateCollabCode}
                            title="Disconnect everyone and issue a new passcode"
                            style={{
                              width: '100%',
                              fontSize: 'var(--text-xs)',
                              fontWeight: 'var(--weight-semibold)',
                              background: 'transparent',
                              color: 'var(--color-warning)',
                              border: '1px solid var(--color-warning)',
                              padding: '6px 0',
                              borderRadius: 'var(--radius-md)',
                              cursor: 'pointer',
                              transition: 'background var(--duration-fast) var(--ease-default)'
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-warning-muted)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            Change passcode
                          </button>
                        )}
                      </div>
                    )}

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
                              // Not a token. This label sits on whatever image the
                              // preset carries, not on a theme surface, and the
                              // shadow below is what makes it legible there.
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
                        color: getTextColorForBackground(customSolidColor),
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
                              // On the gradient itself, which has no single
                              // colour to pick a readable foreground from.
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
                        {/* White on its own black scrim, so the theme does not reach it. */}
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

          {/* Adding a column lives at the end of the column row, where the
              new column will appear. A second button in the header only cost
              space in a header that has too little of it. */}

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
          collisionDetection={collisionDetection}
          measuring={{
            droppable: {
              strategy: MeasuringStrategy.WhileDragging
            }
          }}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
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
              {columns.map(col => {
                const colCards = getCardsForColumn(col.id)
                // The gap is only drawn for a card arriving from elsewhere.
                // Reordering inside a column already parts the list through
                // dnd-kit's sortable transforms, and both at once would be the
                // same thing said twice.
                const foreign = activeDragCard !== null && activeDragCard.status !== col.id
                // A column that sorts itself would move the card out of the gap
                // the moment it landed in it, so it gets the highlight and no
                // promise about where.
                const aimable = canAimAtSlot(col, swimlanesEnabled)
                const slot = foreign && aimable && dropTarget?.column === col.id
                  ? (dropTarget.before === null
                      ? colCards.length
                      : colCards.findIndex(c => c.id === dropTarget.before))
                  : -1
                return (
                <SortableColumn
                  key={col.id}
                  col={col}
                  cards={colCards}
                  dropSlot={slot === -1 ? null : slot}
                  dropHeight={dragHeight}
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
                )
              })}

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
              <div style={{ width: '280px', pointerEvents: 'none' }}>
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
                            style={{ background: 'var(--color-error)', border: 'none', color: 'var(--color-on-accent)', fontSize: '10px', fontWeight: 'var(--weight-bold)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '3px 10px' }}
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
                                color: 'var(--color-on-accent)', fontSize: '10px', lineHeight: '13px', textAlign: 'center', fontWeight: 'bold'
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
          cardDisplay={cardDisplay}
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
      {/* Hidden by a container query when the bar is narrow, leaving the
          icon and the title tooltip. See .kanban-btn-label in index.css. */}
      <span className="kanban-btn-label">{children}</span>
    </button>
  )
}
