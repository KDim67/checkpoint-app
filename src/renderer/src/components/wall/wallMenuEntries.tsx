import type { Dispatch, SetStateAction } from 'react'
import { StickyNote, Type, Square, Layers, Maximize2, Trash2, ArrowUp, ArrowDown, Copy, Lock, Unlock, ExternalLink, Wand2, Expand, Palette, Link2, Unlink, RefreshCw, ClipboardCopy, ClipboardPaste, Scissors, Paintbrush, PaintBucket } from 'lucide-react'
import { bringToFront, createWallItem, sendToBack, type WallDoc, type WallItem, type WallItemKind } from '../../../../shared/wallModel'
import { isLinkable } from '../../../../shared/wallLink'
import { derivePalette, derivePbrMaps, deriveUpscale } from '../../lib/wallImageOps'
import type { useToast } from '../ui/Toast'
import type { MenuEntry } from './WallContextMenu'

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
  /** typed off useToast so they can't drift */
  toast: ReturnType<typeof useToast>['toast']
  followLink: (link: string) => void
  copyItemLink: (item: WallItem) => void
  setItemLink: (id: string, link: string | undefined) => void
  refreshPreview: (id: string) => Promise<void>
  /** the selection bar's field, the item is already selected */
  openLinkEditor: () => void
  copyItems: () => void
  cutItems: () => void
  copyStyle: () => void
  pasteStyle: () => void
  /** greyed out rather than offering what can't happen */
  canPasteStyle: boolean
  pasteHere: (at: { x: number; y: number }) => void
  canPaste: boolean
}

/** item menu for an item, canvas menu for a spot */
export function wallMenuEntries(ctx: WallMenuContext): MenuEntry[] {
  const {
    menu, doc, docRef, selectedIds, setSelectedIds, setItems, addItem, openCard,
    duplicateSelected, toggleLock, removeSelected, fitToContent, runImageOp, placeDerived, toast,
    followLink, copyItemLink, setItemLink, refreshPreview, openLinkEditor, copyItems, cutItems,
    copyStyle, pasteStyle, canPasteStyle, pasteHere, canPaste
  } = ctx
  if (!menu) return []

  if (menu.itemId) {
    const item = doc.items.find(i => i.id === menu.itemId)
    if (!item) return []
    const many = selectedIds.size > 1

    // single image only, these read source pixels
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
              // swatches: squares under the image to paint other items with
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

    const link = item.link
    const linkEntries: MenuEntry[] = many
      ? []
      : [
          ...(link ? [{ label: 'Open link', icon: <ExternalLink size={13} />, hint: 'Ctrl click', onClick: () => followLink(link) }] : []),
          ...(isLinkable(item.kind) && !item.locked
            ? [{ label: link ? 'Edit link' : 'Add a link', icon: <Link2 size={13} />, onClick: openLinkEditor }]
            : []),
          // an arrow has no place of its own to land on
          ...(item.kind !== 'arrow'
            ? [{ label: 'Copy link to this item', icon: <Copy size={13} />, onClick: () => copyItemLink(item) }]
            : []),
          ...(item.kind === 'bookmark' && !item.locked
            ? [{ label: 'Refresh preview', icon: <RefreshCw size={13} />, onClick: () => void refreshPreview(item.id) }]
            : []),
          // a bookmark without its address is nothing
          ...(link && isLinkable(item.kind) && !item.locked
            ? [{ label: 'Remove link', icon: <Unlink size={13} />, onClick: () => setItemLink(item.id, undefined) }]
            : [])
        ]

    return [
      ...imageOps,
      ...(item.kind === 'card' && !many
        ? [{ label: 'Open card', icon: <ExternalLink size={13} />, onClick: () => openCard(item) }]
        : []),
      ...linkEntries,
      { label: many ? `Copy ${selectedIds.size} items` : 'Copy', icon: <ClipboardCopy size={13} />, hint: 'Ctrl C', onClick: copyItems },
      { label: many ? `Cut ${selectedIds.size} items` : 'Cut', icon: <Scissors size={13} />, hint: 'Ctrl X', onClick: cutItems },
      ...(many ? [] : [{ label: 'Copy style', icon: <Paintbrush size={13} />, onClick: copyStyle }]),
      { label: 'Paste style', icon: <PaintBucket size={13} />, onClick: pasteStyle, disabled: !canPasteStyle },
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
    { label: 'Paste here', icon: <ClipboardPaste size={13} />, hint: 'Ctrl V', onClick: () => pasteHere(menu.at), disabled: !canPaste },
    { label: 'Select all', icon: <Layers size={13} />, hint: 'Ctrl A', onClick: () => setSelectedIds(new Set(doc.items.filter(i => !i.locked).map(i => i.id))) },
    { label: 'Fit to content', icon: <Maximize2 size={13} />, onClick: fitToContent, disabled: doc.items.length === 0 }
  ]
}
