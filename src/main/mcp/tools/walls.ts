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
    ...(item.color ? { color: item.color } : {}),
    ...(item.rotation ? { rotation: item.rotation } : {}),
    ...(item.locked ? { locked: true } : {}),
    ...(item.link ? { link: item.link } : {})
  }
}

/** freeform canvases and what's on them */
export function registerWallTools(mcp: McpServer): void {
  mcp.registerTool(
    'list_walls',
    {
      description:
        "List a workspace's walls. A wall is a freeform canvas holding sticky notes, text, frames, images and references to cards and notes.",
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
        "Read one wall: every item on it with its position, size and kind. Cards and notes are references, so each also carries the title of the thing it points at. Omit wall_id for the wall the workspace was last on.",
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
        "Put something on a wall. 'note' is a sticky note and 'text' a bare label; both take text. 'card' and 'doc' are references: give ref an item id or a note title, and the wall shows the live thing rather than a copy. 'frame' is a labelled region. 'bookmark' is a card for a web page: give link, and the page's title, description and icon are read before it is placed. x and y are where the item is CENTRED, not its top-left corner, so the coordinates that come back are offset by half its size. Both are optional and default to the origin. link makes the item open a web address, or jump to another item when given wall:<wall_id>/<item_id> using ids from list_walls and get_wall.",
      inputSchema: {
        context,
        wall_id: z.string().optional(),
        kind: z.enum(['note', 'text', 'frame', 'card', 'doc', 'bookmark']),
        text: z.string().optional().describe('Body for note and text; the label for frame.'),
        ref: z.string().optional().describe('Item id for kind=card, note title for kind=doc.'),
        x: z.number().optional(),
        y: z.number().optional(),
        color: z.string().optional().describe('Hex, e.g. #f6c453.'),
        link: z.string().optional().describe('A web address like https://example.com, or wall:<wall_id>/<item_id>.')
      }
    },
    async ({ context: ctx, wall_id, kind, text: body, ref, x, y, color, link }) => {
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
        { ...(body ? { text: body } : {}), ...(ref ? { ref } : {}), ...(color ? { color } : {}), ...(itemLinkValue ? { link: itemLinkValue } : {}), ...bookmark }
      )

      setSetting(wall.key, { ...doc, items: [...doc.items, created] })
      recordMcpActivity(
        'place_on_wall',
        ctx,
        `Placed a ${kind} on the wall "${wall.name}"`,
        [{ kind: 'remove_wall_item', key: wall.key, itemId: created.id }]
      )
      notifyRenderer()
      return json({ placed: describeWallItem(created, () => undefined), wall: { id: wall.id, name: wall.name } })
    }
  )
}
