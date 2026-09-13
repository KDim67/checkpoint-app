import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getAllItems, getItemById, getSetting, setSetting } from '../../db'
import {
  createWallItem,
  normalizeWallDoc,
  normalizeWallIndex,
  wallDocKey,
  wallIndexKey,
  type WallDoc,
  type WallItem,
  type WallItemKind
} from '../../../shared/wallModel'
import { normalizeLinkInput, parseWallLink } from '../../../shared/wallLink'
import { addedIds, changedItems, connectWallItems, editWallItem, missingMessage, removeWallItems } from '../../../shared/wallEdit'
import { groupItems, ungroupItems } from '../../../shared/wallGroup'
import { alignableUnits, alignItems, distributeItems } from '../../../shared/wallAlign'
import { binRemoved } from '../../../shared/wallBin'
import { CODE_LANGUAGES } from '../../../shared/wallCode'
import type { McpUndoAction } from '../../../shared/mcpActivity'
import { fetchLinkPreview } from '../../linkPreview'
import { recordMcpActivity } from '../../mcpActivity'
import { context, json, notifyRenderer, text, z } from '../toolKit'

/** walls after the first are keyed by id; an unknown id errors rather than looking empty */
function resolveWall(context: string, wallId?: string): { id: string; name: string; key: string } {
  const index = normalizeWallIndex(getSetting<unknown>(wallIndexKey(context), null))
  const wall = wallId
    ? index.walls.find(w => w.id === wallId)
    : index.walls.find(w => w.id === index.activeId) ?? index.walls[0]

  if (!wall) throw new Error(`No wall '${wallId}' in workspace '${context}'. Use list_walls to see what exists.`)
  return { id: wall.id, name: wall.name, key: wallDocKey(context, wall.id) }
}

function readWallDoc(key: string): WallDoc {
  return normalizeWallDoc(getSetting<unknown>(key, null))
}

/** include the target's title, bare ids would need a call per card */
function describeWallItem(item: WallItem, titleOf: (item: WallItem) => string | undefined): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    x: Math.round(item.x),
    y: Math.round(item.y),
    width: Math.round(item.width),
    height: Math.round(item.height),
    ...(item.ref ? { ref: item.ref, title: titleOf(item) } : {}),
    ...(item.text ? { text: item.text } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
    ...(item.shape ? { shape: item.shape } : {}),
    ...(item.color ? { color: item.color } : {}),
    ...(item.rotation ? { rotation: item.rotation } : {}),
    ...(item.locked ? { locked: true } : {}),
    ...(item.link ? { link: item.link } : {}),
    ...(item.group ? { group: item.group } : {}),
    ...(item.from ? { from: item.from } : {}),
    ...(item.to ? { to: item.to } : {}),
    ...(item.align ? { align: item.align } : {}),
    ...(item.borderColor ? { border_color: item.borderColor } : {}),
    ...(item.radius !== undefined ? { radius: item.radius } : {}),
    ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
    ...(item.tags ? { tags: item.tags } : {}),
    ...(item.language ? { language: item.language } : {}),
    ...(item.map ? { mind_map: item.map } : {})
  }
}

const languages = CODE_LANGUAGES.map(l => l.id).join(', ')

/** read back at undo time, so only this call reverses and later edits stay */
function undoFor(key: string, before: WallItem[], after: WallItem[]): McpUndoAction[] {
  return [{ kind: 'restore_wall_items', key, items: changedItems(before, after), removeIds: addedIds(before, after) }]
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const itemIds = z.array(z.string()).min(1).describe('Item ids from get_wall.')

/** freeform canvases and what's on them */
export function registerWallTools(mcp: McpServer): void {
  mcp.registerTool(
    'list_walls',
    {
      description:
        "List a workspace's walls. A wall is a freeform canvas holding sticky notes, text, shapes, code blocks, mind maps, frames, images, arrows and references to cards and notes.",
      inputSchema: { context }
    },
    async ({ context: ctx }) => {
      const index = normalizeWallIndex(getSetting<unknown>(wallIndexKey(ctx), null))
      return json({
        context: ctx,
        walls: index.walls.map(w => ({
          id: w.id,
          name: w.name,
          active: w.id === index.activeId,
          items: readWallDoc(wallDocKey(ctx, w.id)).items.length
        }))
      })
    }
  )

  mcp.registerTool(
    'get_wall',
    {
      description:
        "Read one wall: every item on it with its position (top-left corner), size and kind. Cards and notes are references, so each also carries the title of the thing it points at. Arrows carry the ids they run from and to, and grouped items share a group id. Sticky notes carry their tags and code blocks their language. Mind map topics share a mind_map id, and each topic hangs from the topic whose arrow points at it. Omit wall_id for the wall the workspace was last on.",
      inputSchema: {
        context,
        wall_id: z.string().optional().describe('From list_walls. Defaults to the workspace\'s active wall.')
      }
    },
    async ({ context: ctx, wall_id }) => {
      const wall = resolveWall(ctx, wall_id)
      const doc = readWallDoc(wall.key)
      const cards = new Map(getAllItems(ctx, 'card').map(c => [c.id, c]))
      const titleOf = (item: WallItem): string | undefined =>
        item.kind === 'card' ? cards.get(item.ref ?? '')?.title : item.ref

      return json({
        context: ctx,
        wall: { id: wall.id, name: wall.name },
        items: doc.items.map(i => describeWallItem(i, titleOf))
      })
    }
  )

  mcp.registerTool(
    'place_on_wall',
    {
      description:
        "Put something on a wall. 'note' is a sticky note and 'text' a bare label; both take text. 'card' and 'doc' are references: give ref an item id or a note title, and the wall shows the live thing rather than a copy. 'frame' is a labelled region. 'shape' holds text inside an outline picked with shape. 'code' is a code block: give its source as text and optionally language. 'bookmark' is a card for a web page: give link, and the page's title, description and icon are read before it is placed. align, border_color, radius and opacity style it as update_wall_item does, and tags labels a sticky note. x and y are where the item is CENTRED, not its top-left corner, so the coordinates that come back are offset by half its size. Both are optional and default to the origin. link makes the item open a web address, or jump to another item when given wall:<wall_id>/<item_id> using ids from list_walls and get_wall.",
      inputSchema: {
        context,
        wall_id: z.string().optional(),
        kind: z.enum(['note', 'text', 'frame', 'card', 'doc', 'bookmark', 'shape', 'code']),
        text: z.string().optional().describe('Body for note and text, where new lines, **bold**, _italic_, ~~strike~~, `code`, "- " bullets and "1. " numbered items show as formatting; the label for frame; the source, as written, for code.'),
        ref: z.string().optional().describe('Item id for kind=card, note title for kind=doc.'),
        x: z.number().optional(),
        y: z.number().optional(),
        color: z.string().optional().describe('Hex, e.g. #f6c453.'),
        link: z.string().optional().describe('A web address like https://example.com, or wall:<wall_id>/<item_id>.'),
        shape: z.enum(['rectangle', 'rounded', 'oval', 'diamond', 'triangle']).optional()
          .describe("The outline for kind 'shape', a rectangle when left out."),
        align: z.enum(['left', 'center', 'right']).optional().describe('Where the words sit in a sticky, text box or shape.'),
        border_color: z.string().optional().describe("A shape's outline colour as hex."),
        radius: z.number().optional().describe("A rounded shape's corner radius in pixels, 0 to 200."),
        opacity: z.number().min(0).max(1).optional().describe("A shape's fill opacity, from 0.1 to 1."),
        tags: z.array(z.string()).optional().describe("A sticky note's tags, matched by name to the board's tags."),
        language: z.string().optional().describe(`A code block's language, one of ${languages}. Plain text when left out.`)
      }
    },
    async ({ context: ctx, wall_id, kind, text: body, ref, x, y, color, link, shape, align, border_color, radius, opacity, tags, language }) => {
      if ((kind === 'card' || kind === 'doc') && !ref) {
        return text(`kind '${kind}' is a reference and needs ref: an item id for a card, a note title for a doc.`)
      }
      // stored as the Wall would store it, or refused before anything is written
      const itemLinkValue = link ? normalizeLinkInput(link) : null
      if (link && !itemLinkValue) {
        return text(`link '${link}' is neither a web address nor a wall:<wall_id>/<item_id> link.`)
      }
      const page = parseWallLink(itemLinkValue)
      if (kind === 'bookmark' && page?.type !== 'url') {
        return text("kind 'bookmark' needs link: a web address like https://example.com.")
      }
      // read before placing so the card arrives whole; a page that won't load still gets a plain card
      const preview = kind === 'bookmark' && page?.type === 'url' ? await fetchLinkPreview(page.url) : null
      const bookmark: Partial<WallItem> = kind === 'bookmark' && page?.type === 'url'
        ? {
            text: body || preview?.title || page.host,
            ...(preview?.description ? { summary: preview.description } : {}),
            ...(preview?.icon ? { ref: preview.icon } : {})
          }
        : {}
      // a missing ref renders as "(missing)" and looks like a bug
      if (kind === 'card' && !getItemById(ref as string)) {
        return text(`No card with id '${ref}'. Use get_board or search_items to find one.`)
      }

      const wall = resolveWall(ctx, wall_id)
      const doc = readWallDoc(wall.key)
      const created = createWallItem(
        kind as WallItemKind,
        { x: x ?? 0, y: y ?? 0 },
        doc.items,
        { ...(body ? { text: body } : {}), ...(ref ? { ref } : {}), ...(color ? { color } : {}), ...(itemLinkValue ? { link: itemLinkValue } : {}), ...bookmark, ...(kind === 'shape' && shape && shape !== 'rectangle' ? { shape } : {}) }
      )
      // through update_wall_item's checks, so a look the kind can't take is refused before anything is written
      const styled = editWallItem([...doc.items, created], created.id, {
        align, radius, opacity, tags, language,
        ...(border_color ? { borderColor: border_color } : {})
      })
      if ('error' in styled) return text(styled.error)

      setSetting(wall.key, { ...doc, items: styled.items })
      recordMcpActivity(
        'place_on_wall',
        ctx,
        `Placed a ${kind} on the wall "${wall.name}"`,
        [{ kind: 'remove_wall_item', key: wall.key, itemId: created.id }]
      )
      notifyRenderer()
      return json({ placed: describeWallItem(styled.item, () => undefined), wall: { id: wall.id, name: wall.name } })
    }
  )

  mcp.registerTool(
    'update_wall_item',
    {
      description:
        "Change one item already on a wall; only the fields given change. x and y move it, and like place_on_wall they are its CENTRE. width and height resize it around its centre. text rewrites a sticky, text box, shape or bookmark, and relabels a frame or arrow. color recolours it, shape changes a shape's outline, link sets or clears where it leads, rotation turns it and locked pins it. align puts the words left, center or right in a sticky, text box or shape, and border_color, radius and opacity style a shape's outline, corners and fill. tags replaces a sticky note's tags, and language sets a code block's language. Moving a frame brings what's inside it. A locked item only moves when the same call passes locked: false. Card and doc items show a real card or note, so change those with update_item or write_note.",
      inputSchema: {
        context,
        wall_id: z.string().optional(),
        item_id: z.string().describe('From get_wall.'),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        text: z.string().optional().describe('New lines, **bold**, _italic_, ~~strike~~, `code`, "- " bullets and "1. " numbered items show as formatting in stickies, text and shapes.'),
        color: z.string().optional().describe("Hex, e.g. #f6c453. An empty string goes back to the item's default colour."),
        shape: z.enum(['rectangle', 'rounded', 'oval', 'diamond', 'triangle']).optional(),
        link: z.string().optional().describe('A web address or wall:<wall_id>/<item_id>. An empty string removes the link.'),
        rotation: z.number().optional().describe('Degrees, clockwise.'),
        locked: z.boolean().optional(),
        align: z.enum(['left', 'center', 'right']).optional(),
        border_color: z.string().optional().describe("A shape's outline colour as hex. An empty string goes back to the default."),
        radius: z.number().optional().describe("A rounded shape's corner radius in pixels, 0 to 200."),
        opacity: z.number().min(0).max(1).optional().describe("A shape's fill opacity, from 0.1 to 1."),
        tags: z.array(z.string()).optional().describe("A sticky note's tags, the whole list. An empty list removes them."),
        language: z.string().optional().describe(`A code block's language, one of ${languages}. An empty string makes it plain text.`)
      }
    },
    async ({ context: ctx, wall_id, item_id, x, y, width, height, text: words, color, shape, link, rotation, locked, align, border_color, radius, opacity, tags, language }) => {
      const wall = resolveWall(ctx, wall_id)
      const doc = readWallDoc(wall.key)
      const result = editWallItem(doc.items, item_id, {
        x, y, width, height, text: words, shape, rotation, locked, align, radius, opacity, tags,
        ...(language !== undefined ? { language: language || null } : {}),
        ...(border_color !== undefined ? { borderColor: border_color || null } : {}),
        ...(color !== undefined ? { color: color || null } : {}),
        ...(link !== undefined ? { link: link || null } : {})
      })
      if ('error' in result) return text(result.error)

      setSetting(wall.key, { ...doc, items: result.items })
      recordMcpActivity('update_wall_item', ctx, `Changed a ${result.item.kind} on the wall "${wall.name}"`, undoFor(wall.key, doc.items, result.items))
      notifyRenderer()
      return json({ updated: describeWallItem(result.item, () => undefined), wall: { id: wall.id, name: wall.name } })
    }
  )

  mcp.registerTool(
    'connect_wall_items',
    {
      description:
        'Draw an arrow from one item on a wall to another. It stays attached as either item moves. route, line and heads style it, label puts words on it and color tints it.',
      inputSchema: {
        context,
        wall_id: z.string().optional(),
        from_id: z.string().describe('From get_wall.'),
        to_id: z.string().describe('From get_wall.'),
        label: z.string().optional(),
        color: z.string().optional().describe('Hex, e.g. #f28b82.'),
        route: z.enum(['straight', 'curved', 'elbow']).optional().describe('Straight when left out.'),
        line: z.enum(['solid', 'dashed', 'dotted']).optional().describe('Solid when left out.'),
        heads: z.enum(['end', 'both', 'none']).optional().describe('A head at the to end when left out.')
      }
    },
    async ({ context: ctx, wall_id, from_id, to_id, label, color, route, line, heads }) => {
      const wall = resolveWall(ctx, wall_id)
      const doc = readWallDoc(wall.key)
      const result = connectWallItems(doc.items, from_id, to_id, { route, line, heads, label, color })
      if ('error' in result) return text(result.error)

      setSetting(wall.key, { ...doc, items: result.items })
      recordMcpActivity('connect_wall_items', ctx, `Connected two items on the wall "${wall.name}"`, undoFor(wall.key, doc.items, result.items))
      notifyRenderer()
      return json({ connected: describeWallItem(result.item, () => undefined), wall: { id: wall.id, name: wall.name } })
    }
  )

  mcp.registerTool(
    'remove_wall_items',
    {
      description:
        "Remove items from a wall by id. Arrows attached to a removed item go with it. What's removed stays in the wall's Recently deleted list for 30 days, so it can be brought back from the Wall, and the removal can also be undone from the activity log. Locked items are refused.",
      inputSchema: { context, wall_id: z.string().optional(), item_ids: itemIds }
    },
    async ({ context: ctx, wall_id, item_ids }) => {
      const wall = resolveWall(ctx, wall_id)
      const doc = readWallDoc(wall.key)
      const result = removeWallItems(doc.items, item_ids)
      if ('error' in result) return text(result.error)

      setSetting(wall.key, { ...doc, items: result.items, bin: binRemoved(doc.bin, result.removed, result.items, Date.now()) })
      recordMcpActivity(
        'remove_wall_items',
        ctx,
        `Removed ${plural(result.removed.length, 'item')} from the wall "${wall.name}"`,
        undoFor(wall.key, doc.items, result.items)
      )
      notifyRenderer()
      return json({ removed: result.removed.map(i => i.id), wall: { id: wall.id, name: wall.name } })
    }
  )

  mcp.registerTool(
    'group_wall_items',
    {
      description:
        'Group items on a wall so they select, move and line up as one. Grouping items that are already in groups joins them all into one new group. Pass ungroup: true to break up the groups the given items belong to instead. Arrows and locked items are never grouped.',
      inputSchema: {
        context,
        wall_id: z.string().optional(),
        item_ids: itemIds,
        ungroup: z.boolean().optional().describe('Break up the groups these items are in.')
      }
    },
    async ({ context: ctx, wall_id, item_ids, ungroup }) => {
      const wall = resolveWall(ctx, wall_id)
      const doc = readWallDoc(wall.key)
      const missing = missingMessage(doc.items, item_ids)
      if (missing) return text(missing)

      const ids = new Set(item_ids)
      const next = ungroup ? ungroupItems(doc.items, ids) : groupItems(doc.items, ids)
      if (next === doc.items) {
        return text(ungroup ? 'None of those items is in a group.' : 'Grouping needs two or more items that are neither arrows nor locked.')
      }

      setSetting(wall.key, { ...doc, items: next })
      recordMcpActivity(
        'group_wall_items',
        ctx,
        `${ungroup ? 'Ungrouped' : 'Grouped'} items on the wall "${wall.name}"`,
        undoFor(wall.key, doc.items, next)
      )
      notifyRenderer()
      return json({
        items: next.filter(i => ids.has(i.id)).map(i => ({ id: i.id, group: i.group ?? null })),
        wall: { id: wall.id, name: wall.name }
      })
    }
  )

  mcp.registerTool(
    'align_wall_items',
    {
      description:
        "Line items up or space them out on a wall. align puts every item's edge or centre on the matching edge of the items taken together: left, right, top or bottom edges, centre to stack them in a column, or middle to set them in a row. distribute leaves the outermost two where they are and makes the gaps between the rest equal, horizontally or vertically, and needs three or more. A group counts as one piece and a frame brings what's inside it; arrows and locked items stay put. Give align or distribute, not both.",
      inputSchema: {
        context,
        wall_id: z.string().optional(),
        item_ids: z.array(z.string()).min(2).describe('Item ids from get_wall.'),
        align: z.enum(['left', 'centre', 'right', 'top', 'middle', 'bottom']).optional(),
        distribute: z.enum(['horizontal', 'vertical']).optional()
      }
    },
    async ({ context: ctx, wall_id, item_ids, align, distribute }) => {
      if ((align === undefined) === (distribute === undefined)) return text('Give either align or distribute.')
      const wall = resolveWall(ctx, wall_id)
      const doc = readWallDoc(wall.key)
      const missing = missingMessage(doc.items, item_ids)
      if (missing) return text(missing)

      const ids = new Set(item_ids)
      const needed = align ? 2 : 3
      if (alignableUnits(doc.items, ids) < needed) {
        return text(`${align ? 'Lining up' : 'Spacing out'} needs ${needed} or more pieces that are neither arrows nor locked, and a group counts as one.`)
      }
      const next = align ? alignItems(doc.items, ids, align) : distributeItems(doc.items, ids, distribute ?? 'horizontal')
      if (next === doc.items) return text('Those items are already in place.')

      setSetting(wall.key, { ...doc, items: next })
      recordMcpActivity(
        'align_wall_items',
        ctx,
        `${align ? 'Lined up' : 'Spaced out'} items on the wall "${wall.name}"`,
        undoFor(wall.key, doc.items, next)
      )
      notifyRenderer()
      return json({
        items: next.filter(i => ids.has(i.id)).map(i => describeWallItem(i, () => undefined)),
        wall: { id: wall.id, name: wall.name }
      })
    }
  )
}
