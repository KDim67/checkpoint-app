import type { Dispatch, SetStateAction } from 'react'
import { StickyNote, Type, Square, Layers, Maximize2, Trash2, ArrowUp, ArrowDown, Copy, Lock, Unlock, ExternalLink, Wand2, Expand, Palette } from 'lucide-react'
import { bringToFront, createWallItem, sendToBack, type WallDoc, type WallItem, type WallItemKind } from '../../../../shared/wallModel'
import { derivePalette, derivePbrMaps, deriveUpscale } from '../../lib/wallImageOps'
import type { useToast } from '../ui/Toast'
import type { MenuEntry } from './WallContextMenu'

/** What the wall's context menu needs from the wall to build its entries. */
export interface WallMenuContext {
  menu: { itemId: string | null; at: { x: number; y: number } } | null
  doc: WallDoc
  docRef: { current: WallDoc }
  selectedIds: Set<string>
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>
  setItems: (items: WallItem[]) => void
  addItem: (kind: WallItemKind, extra?: Partial<WallItem>, at?: { x: number; y: number }) => void
  openCard: (item: WallItem) => void
  duplicateSelected: () => void
  toggleLock: () => void
  removeSelected: () => void
  fitToContent: () => void
  runImageOp: (label: string, job: () => Promise<void>) => Promise<void>
  placeDerived: (source: WallItem, made: { filename: string; label: string; width: number; height: number }[]) => void
  /** Typed off useToast so the two cannot drift apart. */
  toast: ReturnType<typeof useToast>['toast']
}

/** A right-click on an item offers what can be done to it; on empty wall, what can be put there. */
export function wallMenuEntries(ctx: WallMenuContext): MenuEntry[] {
  const {
    menu, doc, docRef, selectedIds, setSelectedIds, setItems, addItem, openCard,
    duplicateSelected, toggleLock, removeSelected, fitToContent, runImageOp, placeDerived, toast
  } = ctx
  if (!menu) return []

  if (menu.itemId) {
    const item = doc.items.find(i => i.id === menu.itemId)
    if (!item) return []
    const many = selectedIds.size > 1

    // Only for a single image: these read the source pixels, and there is no
    // sensible meaning for "generate maps" from a mixed selection.
    const imageOps: MenuEntry[] = item.kind === 'image' && item.ref && !many
      ? [
          {
            label: 'Generate PBR maps',
            icon: <Wand2 size={13} />,
            onClick: () => void runImageOp('Generating maps', async () => {
              placeDerived(item, await derivePbrMaps(item.ref as string))
            })
          },
          {
            label: 'Upscale 2×',
            icon: <Expand size={13} />,
            onClick: () => void runImageOp('Upscaling', async () => {
              placeDerived(item, [await deriveUpscale(item.ref as string, 2)])
            })
          },
          {
            label: 'Upscale 3×',
            icon: <Expand size={13} />,
            onClick: () => void runImageOp('Upscaling', async () => {
              placeDerived(item, [await deriveUpscale(item.ref as string, 3)])
            })
          },
          {
            label: 'Extract palette',
            icon: <Palette size={13} />,
            onClick: () => void runImageOp('Reading colours', async () => {
              const colors = await derivePalette(item.ref as string)
              if (colors.length === 0) { toast('No colours found in that image.'); return }
              // Swatches: small squares in a row under the image, each one a
              // colour you can then paint other items with.
              const base = docRef.current.items
              const swatches = colors.map((c, i) =>
                createWallItem('note', {
                  x: item.x + i * 56 + 24,
                  y: item.y + item.height + 24
                }, base, { color: c, text: c, width: 48, height: 48 })
              )
              setItems([...base, ...swatches])
              setSelectedIds(new Set(swatches.map(sw => sw.id)))
            })
          }
        ]
      : []

    return [
      ...imageOps,
      ...(item.kind === 'card' && !many
        ? [{ label: 'Open card', icon: <ExternalLink size={13} />, onClick: () => openCard(item) }]
        : []),
      { label: many ? `Duplicate ${selectedIds.size} items` : 'Duplicate', icon: <Copy size={13} />, hint: 'Ctrl D', onClick: duplicateSelected },
      { label: 'Bring to front', icon: <ArrowUp size={13} />, onClick: () => setItems(bringToFront(doc.items, item.id)) },
      { label: 'Send to back', icon: <ArrowDown size={13} />, onClick: () => setItems(sendToBack(doc.items, item.id)) },
      {
        label: item.locked ? 'Unlock' : 'Lock in place',
        icon: item.locked ? <Unlock size={13} /> : <Lock size={13} />,
        onClick: toggleLock
      },
      { label: many ? `Delete ${selectedIds.size} items` : 'Delete', icon: <Trash2 size={13} />, hint: 'Del', destructive: true, onClick: removeSelected }
    ]
  }

  return [
    { label: 'Sticky note here', icon: <StickyNote size={13} />, onClick: () => addItem('note', {}, menu.at) },
    { label: 'Text here', icon: <Type size={13} />, onClick: () => addItem('text', {}, menu.at) },
    { label: 'Frame here', icon: <Square size={13} />, onClick: () => addItem('frame', {}, menu.at) },
    { label: 'Select all', icon: <Layers size={13} />, hint: 'Ctrl A', onClick: () => setSelectedIds(new Set(doc.items.filter(i => !i.locked).map(i => i.id))) },
    { label: 'Fit to content', icon: <Maximize2 size={13} />, onClick: fitToContent, disabled: doc.items.length === 0 }
  ]
}
