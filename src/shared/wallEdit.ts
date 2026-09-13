/** changing what's already on a wall, for the assistant; every refusal is decided before anything changes */

import {
  cleanTags, createWallItem, moveItems, pruneArrows, withFrameContents, ARROW_HEAD_MODES, ARROW_LINES, ARROW_SHAPES, SHAPE_TYPES,
  type ArrowHeads, type ArrowLine, type ArrowShape, type ShapeType, type TextAlign, type WallItem
} from './wallModel'
import { isLinkable, normalizeLinkInput } from './wallLink'
import { CODE_LANGUAGES, isCodeLanguage } from './wallCode'

export type WallEdit = { items: WallItem[]; item: WallItem } | { error: string }

export interface WallItemPatch {
  /** the centre, as items are placed */
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  /** null goes back to the kind's default */
  color?: string | null
  shape?: ShapeType
  /** null takes the link off */
  link?: string | null
  rotation?: number
  locked?: boolean
  align?: TextAlign
  /** null goes back to the default outline */
  borderColor?: string | null
  radius?: number
  opacity?: number
  /** a sticky's whole list; an empty one takes them all off */
  tags?: string[]
  /** a code block's language, null for plain text */
  language?: string | null
}

export interface ArrowStyle {
  route?: ArrowShape
  line?: ArrowLine
  heads?: ArrowHeads
  label?: string
  color?: string
}

/** words of their own; a card or doc shows another record's title */
const WORDED: WallItem['kind'][] = ['note', 'text', 'shape', 'frame', 'arrow', 'bookmark', 'code']

/** one message naming every id the wall doesn't have, null when it has them all */
export function missingMessage(items: WallItem[], ids: string[]): string | null {
  const missing = [...new Set(ids)].filter(id => !items.some(i => i.id === id))
  if (missing.length === 0) return null
  return `No item${missing.length === 1 ? '' : 's'} ${missing.map(id => `'${id}'`).join(', ')} on this wall. Use get_wall to see what's there.`
}

export function editWallItem(items: WallItem[], id: string, patch: WallItemPatch): WallEdit {
  const missing = missingMessage(items, [id])
  if (missing) return { error: missing }
  const item = items.find(i => i.id === id) as WallItem
  const moves = patch.x !== undefined || patch.y !== undefined || patch.width !== undefined || patch.height !== undefined

  if (patch.text !== undefined && !WORDED.includes(item.kind)) {
    if (item.kind === 'card') return { error: 'A card item shows the card it points at. Change the card with update_item.' }
    if (item.kind === 'doc') return { error: 'A doc item shows the note it points at. Change the note with write_note.' }
    return { error: `A ${item.kind} has no text to change.` }
  }
  if (patch.shape !== undefined && item.kind !== 'shape') return { error: 'Only a shape has an outline to change.' }
  if (patch.align !== undefined && item.kind !== 'note' && item.kind !== 'text' && item.kind !== 'shape') {
    return { error: 'Only stickies, text boxes and shapes have words to line up.' }
  }
  if ((patch.borderColor !== undefined || patch.radius !== undefined || patch.opacity !== undefined) && item.kind !== 'shape') {
    return { error: 'Only a shape has a border, corners and a fill to style.' }
  }
  if (patch.tags !== undefined && item.kind !== 'note') return { error: 'Only sticky notes carry tags.' }
  if (patch.language !== undefined && item.kind !== 'code') return { error: 'Only a code block has a language.' }
  if (typeof patch.language === 'string' && !isCodeLanguage(patch.language)) {
    return { error: `language '${patch.language}' isn't one of ${CODE_LANGUAGES.map(l => l.id).join(', ')}.` }
  }
  if (moves && item.kind === 'arrow') return { error: 'An arrow is drawn between its ends. Move the items it connects instead.' }
  if (moves && item.locked && patch.locked !== false) return { error: 'That item is locked. Pass locked: false in the same call to move it.' }
  if (patch.link !== undefined && !isLinkable(item.kind) && item.kind !== 'bookmark') return { error: `A ${item.kind} can't carry a link.` }
  if (patch.link === null && item.kind === 'bookmark') return { error: 'A bookmark is its link. Remove the item instead.' }
  const link = typeof patch.link === 'string' ? normalizeLinkInput(patch.link) : undefined
  if (link === null) return { error: `link '${patch.link}' is neither a web address nor a wall:<wall_id>/<item_id> link.` }

  const width = patch.width !== undefined ? Math.max(40, patch.width) : item.width
  const height = patch.height !== undefined ? Math.max(32, patch.height) : item.height
  // resized around the centre it has, moved to the centre it's given
  const centreX = item.x + item.width / 2
  const centreY = item.y + item.height / 2
  const dx = patch.x !== undefined ? patch.x - centreX : 0
  const dy = patch.y !== undefined ? patch.y - centreY : 0
  const next: WallItem = { ...item, x: centreX + dx - width / 2, y: centreY + dy - height / 2, width, height }

  if (patch.text !== undefined) next.text = patch.text
  if (patch.color === null) delete next.color
  else if (patch.color !== undefined) next.color = patch.color
  if (patch.shape === SHAPE_TYPES[0]) delete next.shape
  else if (patch.shape !== undefined) next.shape = patch.shape
  if (patch.link === null) delete next.link
  else if (link) next.link = link
  if (patch.rotation !== undefined) {
    if (patch.rotation % 360 === 0) delete next.rotation
    else next.rotation = patch.rotation
  }
  if (patch.locked === false) delete next.locked
  else if (patch.locked) next.locked = true
  if (patch.align !== undefined) next.align = patch.align
  if (patch.borderColor === null) delete next.borderColor
  else if (patch.borderColor !== undefined) next.borderColor = patch.borderColor
  if (patch.radius !== undefined) next.radius = Math.min(200, Math.max(0, patch.radius))
  if (patch.opacity !== undefined) {
    const opacity = Math.min(1, Math.max(0.1, patch.opacity))
    if (opacity >= 1) delete next.opacity
    else next.opacity = opacity
  }
  if (patch.tags !== undefined) {
    const tags = cleanTags(patch.tags)
    if (tags.length > 0) next.tags = tags
    else delete next.tags
  }
  if (patch.language === null) delete next.language
  else if (patch.language !== undefined) next.language = patch.language

  // a frame carries what's in it, as when it's dragged; a resize alone leaves them
  const carried = item.kind === 'frame' && (dx !== 0 || dy !== 0)
    ? new Set([...withFrameContents(items, new Set([id]))].filter(other => other !== id))
    : new Set<string>()
  const moved = carried.size > 0 ? moveItems(items, carried, dx, dy) : items
  return { items: moved.map(i => (i.id === id ? next : i)), item: next }
}

export function connectWallItems(items: WallItem[], fromId: string, toId: string, style: ArrowStyle = {}): WallEdit {
  const missing = missingMessage(items, [fromId, toId])
  if (missing) return { error: missing }
  if (fromId === toId) return { error: 'An arrow needs two different items.' }
  if ([fromId, toId].some(id => items.find(i => i.id === id)?.kind === 'arrow')) {
    return { error: 'Arrows connect items, not other arrows.' }
  }

  const label = style.label?.trim()
  const arrow = createWallItem('arrow', { x: 0, y: 0 }, items, {
    from: fromId,
    to: toId,
    ...(label ? { text: label } : {}),
    ...(style.color ? { color: style.color } : {}),
    // defaults left out, as the wall stores them
    ...(style.route && style.route !== ARROW_SHAPES[0] ? { arrowShape: style.route } : {}),
    ...(style.line && style.line !== ARROW_LINES[0] ? { arrowLine: style.line } : {}),
    ...(style.heads && style.heads !== ARROW_HEAD_MODES[0] ? { arrowHeads: style.heads } : {})
  })
  return { items: [...items, arrow], item: arrow }
}

/** connectors left without an end go too, as when they're deleted on the wall */
export function removeWallItems(items: WallItem[], ids: string[]): { items: WallItem[]; removed: WallItem[] } | { error: string } {
  const missing = missingMessage(items, ids)
  if (missing) return { error: missing }
  const locked = items.filter(i => ids.includes(i.id) && i.locked)
  if (locked.length > 0) {
    return { error: `${locked.map(i => `'${i.id}'`).join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked. Unlock with update_wall_item first.` }
  }

  const gone = new Set(ids)
  const kept = pruneArrows(items.filter(i => !gone.has(i.id)))
  const keptIds = new Set(kept.map(i => i.id))
  return { items: kept, removed: items.filter(i => !keptIds.has(i.id)) }
}

/** the before versions of items a change touched or took away; edits copy, so identity says what changed */
export function changedItems(before: WallItem[], after: WallItem[]): WallItem[] {
  const now = new Map(after.map(i => [i.id, i]))
  return before.filter(i => now.get(i.id) !== i)
}

export function addedIds(before: WallItem[], after: WallItem[]): string[] {
  const had = new Set(before.map(i => i.id))
  return after.filter(i => !had.has(i.id)).map(i => i.id)
}

/** reverses a change onto the wall as it is now, so work done since stays */
export function restoreWallSnapshot(items: WallItem[], snapshot: WallItem[], added: string[]): WallItem[] {
  const was = new Map(snapshot.map(i => [i.id, i]))
  const drop = new Set(added)
  const kept = items.filter(i => !drop.has(i.id)).map(i => was.get(i.id) ?? i)
  const present = new Set(kept.map(i => i.id))
  return pruneArrows([...kept, ...snapshot.filter(i => !present.has(i.id))])
}
