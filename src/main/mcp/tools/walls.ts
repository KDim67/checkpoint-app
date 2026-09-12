import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getItemById, getItemsPaginated, getSetting, setSetting } from '../../db'
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
import { recordMcpActivity } from '../../mcpActivity'
import { context, json, notifyRenderer, text, z } from '../toolKit'

/**
 * The wall an agent means. Walls after the first are keyed by their own id, so
 * resolving one takes the index, and an unknown id is an error worth naming
 * rather than an empty wall that looks like a wall with nothing on it.
 */
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

/**
 * An item as an agent should see it: coordinates and kind, plus what the thing
 * it points at is actually called. A bare item id would make the wall unreadable
 * without a second call per card.
 */
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
    ...(item.color ? { color: item.color } : {}),
    ...(item.rotation ? { rotation: item.rotation } : {}),
    ...(item.locked ? { locked: true } : {})
  }
}

/** Walls: the freeform canvases, and what is on them. */
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
      const cards = new Map(getItemsPaginated(ctx, 'card', 1, 1000).items.map(c => [c.id, c]))
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
        "Put something on a wall. 'note' is a sticky note and 'text' a bare label; both take text. 'card' and 'doc' are references: give ref an item id or a note title, and the wall shows the live thing rather than a copy. 'frame' is a labelled region. x and y are where the item is CENTRED, not its top-left corner, so the coordinates that come back are offset by half its size. Both are optional and default to the origin.",
      inputSchema: {
        context,
        wall_id: z.string().optional(),
        kind: z.enum(['note', 'text', 'frame', 'card', 'doc']),
        text: z.string().optional().describe('Body for note and text; the label for frame.'),
        ref: z.string().optional().describe('Item id for kind=card, note title for kind=doc.'),
        x: z.number().optional(),
        y: z.number().optional(),
        color: z.string().optional().describe('Hex, e.g. #f6c453.')
      }
    },
    async ({ context: ctx, wall_id, kind, text: body, ref, x, y, color }) => {
      if ((kind === 'card' || kind === 'doc') && !ref) {
        return text(`kind '${kind}' is a reference and needs ref: an item id for a card, a note title for a doc.`)
      }
      // Checked rather than placed blindly: a reference to nothing renders as a
      // tile reading "(missing)", which looks like a bug in the wall.
      if (kind === 'card' && !getItemById(ref as string)) {
        return text(`No card with id '${ref}'. Use get_board or search_items to find one.`)
      }

      const wall = resolveWall(ctx, wall_id)
      const doc = readWallDoc(wall.key)
      const created = createWallItem(
        kind as WallItemKind,
        { x: x ?? 0, y: y ?? 0 },
        doc.items,
        { ...(body ? { text: body } : {}), ...(ref ? { ref } : {}), ...(color ? { color } : {}) }
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
