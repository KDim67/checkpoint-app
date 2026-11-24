import { nativeImage } from 'electron'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getAllItems, getItemById, getSetting, setSetting } from '../../db'
import { readMediaBuffer, saveBufferToMedia } from '../../mediaService'
import {
  bringToFront,
  createWall,
  createWallItem,
  normalizeWallDoc,
  normalizeWallIndex,
  renameWall,
  sendToBack,
  STROKE_WIDTHS,
  WALL_CANVAS_PRESETS,
  WALL_FONTS,
  wallDocKey,
  wallIndexKey,
  type WallDoc,
  type WallItem,
  type WallItemKind
} from '../../../shared/wallModel'
import { fitImageBox } from '../../../shared/wallImage'
import { normalizeLinkInput, parseWallLink } from '../../../shared/wallLink'
import { addedIds, changedItems, connectWallItems, editWallItem, missingMessage, removeWallItems } from '../../../shared/wallEdit'
import { groupItems, ungroupItems } from '../../../shared/wallGroup'
import { alignableUnits, alignItems, distributeItems } from '../../../shared/wallAlign'
import { binRemoved } from '../../../shared/wallBin'
import { CODE_LANGUAGES } from '../../../shared/wallCode'
import type { McpUndoAction } from '../../../shared/mcpActivity'
import { fetchLinkPreview } from '../../linkPreview'
import { recordMcpActivity } from '../../mcpActivity'
import { context, error, json, notifyRenderer, READ_ONLY_ANNOTATIONS, validateWorkspace, z } from '../toolKit'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_READ_IMAGE_BYTES = 5 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp'
}

function resolveWall(context: string, wallId?: string): { id: string; name: string; key: string } {
  const index = normalizeWallIndex(getSetting<unknown>(wallIndexKey(context), null))
  const wall = wallId
    ? index.walls.find(w => w.id === wallId)
    : index.walls.find(w => w.id === index.activeId) ?? index.walls[0]

  if (!wall) throw new Error(`No wall '${wallId}' in workspace '${context}'. Call get_wall with list_only=true to see what exists.`)
  return { id: wall.id, name: wall.name, key: wallDocKey(context, wall.id) }
}

function readWallDoc(key: string): WallDoc {
  return normalizeWallDoc(getSetting<unknown>(key, null))
}

function describeWallItem(item: WallItem, titleOf: (item: WallItem) => string | undefined): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    x: Math.round(item.x),
    y: Math.round(item.y),
    width: Math.round(item.width),
    height: Math.round(item.height),
    ...(item.ref ? { ref: item.ref, title: titleOf(item) } : {}),
    ...(item.previewImage ? { preview_image: item.previewImage } : {}),
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
    ...(item.font ? { font: item.font } : {}),
    ...(item.fontSize !== undefined ? { font_size: item.fontSize } : {}),
    ...(item.borderColor ? { border_color: item.borderColor } : {}),
    ...(item.radius !== undefined ? { radius: item.radius } : {}),
    ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
    ...(item.tags ? { tags: item.tags } : {}),
    ...(item.language ? { language: item.language } : {}),
    ...(item.map ? { mind_map: item.map } : {}),
    ...(item.strokeWidth !== undefined ? { stroke_width: item.strokeWidth } : {}),
    ...(item.layer ? { layer: item.layer } : {}),
    ...(item.reactions ? { reactions: item.reactions } : {}),
    ...(item.crop ? { crop: item.crop } : {})
  }
}

const languages = CODE_LANGUAGES.map(l => l.id).join(', ')
const fontsList = WALL_FONTS.join(', ')

function undoFor(key: string, before: WallItem[], after: WallItem[]): McpUndoAction[] {
  return [{ kind: 'restore_wall_items', key, items: changedItems(before, after), removeIds: addedIds(before, after) }]
}

/** reads image pixel dimensions from Electron nativeImage or PNG/GIF header fallback */
function measureImageSize(buf: Buffer, ext: string): { width: number; height: number } | null {
  try {
    const fn = (nativeImage as unknown as { createFromBuffer?: (b: Buffer) => { isEmpty(): boolean; getSize(): { width: number; height: number } } })
      ?.createFromBuffer
    if (typeof fn === 'function') {
      const img = fn(buf)
      if (img && !img.isEmpty()) {
        const size = img.getSize()
        if (size.width > 0 && size.height > 0) return size
      }
    }
  } catch {
    // fall through to header inspection
  }

  // lightweight PNG / GIF header fallback for headless environments
  if (ext === '.png' && buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    if (w > 0 && h > 0) return { width: w, height: h }
  }
  if (ext === '.gif' && buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    const w = buf.readUInt16LE(6)
    const h = buf.readUInt16LE(8)
    if (w > 0 && h > 0) return { width: w, height: h }
  }
  return null
}

function ingestImageInput(
  filePath?: string,
  imageBase64?: string,
  mimeType?: string
): { filename: string; naturalSize: { width: number; height: number } | null } | { error: string } {
  if (filePath) {
    if (!existsSync(filePath)) return { error: `Image file not found at "${filePath}".` }
    const stat = statSync(filePath)
    if (!stat.isFile()) return { error: `"${filePath}" is not a file.` }
    if (stat.size === 0) return { error: `Image file "${filePath}" is empty.` }
    if (stat.size > MAX_IMAGE_BYTES) {
      return { error: `Image file "${filePath}" exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB limit.` }
    }
    const ext = extname(filePath).toLowerCase()
    if (!MIME_BY_EXT[ext]) {
      return { error: `Unsupported image format "${ext}". Supported: ${Object.keys(MIME_BY_EXT).join(', ')}.` }
    }
    const buf = readFileSync(filePath)
    const filename = saveBufferToMedia(buf, ext)
    return { filename, naturalSize: measureImageSize(buf, ext) }
  }

  if (imageBase64) {
    let raw = imageBase64.trim()
    let detectedMime = mimeType?.toLowerCase().trim()
    const dataUrlMatch = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(raw)
    if (dataUrlMatch) {
      detectedMime = detectedMime || dataUrlMatch[1].toLowerCase()
      raw = dataUrlMatch[2]
    }
    const ext = detectedMime ? EXT_BY_MIME[detectedMime] : '.png'
    if (!ext) {
      return { error: `Unsupported mime_type "${detectedMime}". Supported: ${Object.keys(EXT_BY_MIME).join(', ')}.` }
    }
    const buf = Buffer.from(raw, 'base64')
    if (buf.length === 0) return { error: 'image_base64 decoded to empty bytes.' }
    if (buf.length > MAX_IMAGE_BYTES) {
      return { error: `Image payload exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB limit.` }
    }
    const filename = saveBufferToMedia(buf, ext)
    return { filename, naturalSize: measureImageSize(buf, ext) }
  }

  return { error: "kind 'image' requires either file_path or image_base64." }
}

const wallOpSchema = z
  .object({
    op: z
      .enum([
        'place',
        'update',
        'connect',
        'remove',
        'group',
        'ungroup',
        'align',
        'distribute',
        'layer_order',
        'create_wall',
        'rename_wall',
        'set_background'
      ])
      .describe('Wall operation to perform.'),
    // optional client alias inside one edit_wall batch so arrows/aligns can reference newly placed items
    temp_id: z.string().optional().describe('Optional local id inside this batch so subsequent ops (e.g. connect) can reference this placed item.'),
    kind: z.enum(['note', 'text', 'frame', 'card', 'doc', 'bookmark', 'shape', 'code', 'image', 'arrow']).optional(),
    item_id: z.string().optional().describe('Target item id (for update).'),
    item_ids: z.array(z.string()).optional().describe('Target item ids (for remove, group, ungroup, align, distribute, layer_order).'),
    from_id: z.string().optional().describe('Arrow start item id or temp_id.'),
    to_id: z.string().optional().describe('Arrow end item id or temp_id.'),
    text: z.string().optional().describe('Text body, frame/arrow label, or source code.'),
    label: z.string().optional().describe('Alias for text on arrows.'),
    ref: z.string().optional().describe('Item id for kind=card, note title for kind=doc.'),
    file_path: z.string().optional().describe('Local image/GIF/SVG path when placing kind=image.'),
    image_base64: z.string().optional().describe('Base64 image data (or data:image/... URI) when placing kind=image.'),
    mime_type: z.string().optional().describe('Optional image MIME type (e.g. image/png, image/gif) for image_base64.'),
    x: z.number().optional().describe('Centre X coordinate on wall (default 0 on place).'),
    y: z.number().optional().describe('Centre Y coordinate on wall (default 0 on place).'),
    width: z.number().optional(),
    height: z.number().optional(),
    color: z.string().optional().describe('Hex colour, or empty string on update to reset.'),
    link: z.string().optional().describe('Web URL or wall:<wall_id>/<item_id>. Empty string removes link on update.'),
    shape: z.enum(['rectangle', 'rounded', 'oval', 'diamond', 'triangle']).optional(),
    align: z.enum(['left', 'center', 'right', 'centre', 'top', 'middle', 'bottom']).optional(),
    distribute: z.enum(['horizontal', 'vertical']).optional(),
    order: z.enum(['front', 'back']).optional().describe('For layer_order: bring to front or send to back.'),
    rotation: z.number().optional(),
    locked: z.boolean().optional(),
    font: z.string().optional().describe(`Font family: ${fontsList}.`),
    font_size: z.number().nullable().optional().describe('Font size in px, or null to auto-fit.'),
    border_color: z.string().optional(),
    radius: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(),
    language: z.string().optional().describe(`Code language: ${languages}.`),
    route: z.enum(['straight', 'curved', 'elbow']).optional(),
    line: z.enum(['solid', 'dashed', 'dotted']).optional(),
    heads: z.enum(['end', 'both', 'none']).optional(),
    stroke_width: z.number().optional().describe(`Arrow/ink stroke width (${STROKE_WIDTHS.join(', ')} px).`),
    layer: z.enum(['front', 'back']).nullable().optional().describe("Arrow layer relative to items ('front' or 'back')."),
    reactions: z.record(z.string(), z.number()).optional().describe('Emoji reaction counts map (empty object clears).'),
    name: z.string().optional().describe('Wall name (for create_wall or rename_wall).'),
    background: z.string().optional().describe(`Background hex or preset (${WALL_CANVAS_PRESETS.map(p => p.id).join(', ')}).`)
  })
  .passthrough()

/** freeform canvases and what's on them */
export function registerWallTools(mcp: McpServer): void {
  mcp.registerTool(
    'get_wall',
    {
      title: 'Get Wall',
      description:
        "Inspect a workspace's walls and canvas items. Lists all walls and returns every item on the target wall " +
        '(position is top-left corner, size, kind, links, arrows, tags, code language, layer, stroke_width and reactions). ' +
        'Set list_only=true to list walls without item details, or omit wall_id for the active wall.',
      inputSchema: {
        context,
        wall_id: z.string().optional().describe('From list_only or previous get_wall. Defaults to the active wall.'),
        list_only: z.boolean().optional().describe('If true, returns only the list of walls and item counts.')
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ context: ctx, wall_id, list_only }) => {
      const bad = validateWorkspace(ctx)
      if (bad) return error(bad)

      const index = normalizeWallIndex(getSetting<unknown>(wallIndexKey(ctx), null))
      const walls = index.walls.map(w => ({
        id: w.id,
        name: w.name,
        active: w.id === index.activeId,
        items: readWallDoc(wallDocKey(ctx, w.id)).items.length
      }))

      if (list_only) {
        return json({ context: ctx, walls })
      }

      let wall: { id: string; name: string; key: string }
      try {
        wall = resolveWall(ctx, wall_id)
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err))
      }

      const doc = readWallDoc(wall.key)
      const cards = new Map(getAllItems(ctx, 'card').map(c => [c.id, c]))
      const titleOf = (item: WallItem): string | undefined =>
        item.kind === 'card' ? cards.get(item.ref ?? '')?.title : item.ref

      return json({
        context: ctx,
        wall: { id: wall.id, name: wall.name, background: doc.background },
        walls,
        items: doc.items.map(i => describeWallItem(i, titleOf))
      })
    }
  )

  mcp.registerTool(
    'edit_wall',
    {
      title: 'Edit Wall',
      description:
        'Apply one or more atomic operations to a wall (single Undo step for item edits). Supports placing notes, text, ' +
        "frames, cards, docs, bookmarks, shapes, code blocks, images (from file_path or image_base64), and arrows; " +
        'updating properties (centre x/y, size, colour, font, font_size, reactions, stroke_width, layer); connecting items; ' +
        'removing, grouping, aligning/distributing, changing z-order (layer_order); and creating/renaming walls or setting background. ' +
        'Use temp_id on place ops to reference newly created items in later connect/align ops within the same call.',
      inputSchema: {
        context,
        wall_id: z.string().optional().describe('Target wall id (defaults to active wall).'),
        operations: z.array(wallOpSchema).min(1).describe('Ordered list of wall operations to execute atomically.')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ context: ctx, wall_id, operations }) => {
      if (!ctx.trim()) return error('Workspace context cannot be empty.')

      const idxKey = wallIndexKey(ctx)
      let index = normalizeWallIndex(getSetting<unknown>(idxKey, null))
      let activeWallId = wall_id
      const createdWallIds: string[] = []
      const firstOp = operations[0]
      if (firstOp.op === 'create_wall' && !activeWallId) {
        // creating a wall first allows follow-up ops in the same call to populate it directly
        const created = createWall(index, firstOp.name)
        index = created.index
        activeWallId = created.wall.id
        createdWallIds.push(created.wall.id)
      }

      const targetRef = activeWallId
        ? index.walls.find(w => w.id === activeWallId)
        : index.walls.find(w => w.id === index.activeId) ?? index.walls[0]

      if (!targetRef) {
        return error(`No wall '${activeWallId}' in workspace '${ctx}'. Call get_wall with list_only=true to see what exists.`)
      }

      const key = wallDocKey(ctx, targetRef.id)
      const originalDoc = readWallDoc(key)
      const originalName = targetRef.name
      const originalBg = originalDoc.background
      let currentItems = [...originalDoc.items]
      let currentBin = originalDoc.bin
      let currentBg = originalDoc.background
      let wallName = targetRef.name
      let indexChanged = createdWallIds.length > 0
      let renamed = false
      let bgChanged = false

      const aliases = new Map<string, string>()
      const resolveId = (id: string): string => aliases.get(id) ?? id
      const resolveIds = (ids: string[] | undefined): string[] => (ids ?? []).map(resolveId)

      const summarySteps: string[] = []
      const results: Record<string, unknown>[] = []

      for (let idx = 0; idx < operations.length; idx++) {
        const op = operations[idx]

        if (op.op === 'create_wall') {
          if (idx === 0 && createdWallIds.includes(targetRef.id)) {
            summarySteps.push(`created wall "${wallName}"`)
            results.push({ op: 'create_wall', wall_id: targetRef.id, name: wallName })
            continue
          }
          const created = createWall(index, op.name)
          index = created.index
          indexChanged = true
          createdWallIds.push(created.wall.id)
          summarySteps.push(`created wall "${created.wall.name}"`)
          results.push({ op: 'create_wall', wall_id: created.wall.id, name: created.wall.name })
          continue
        }

        if (op.op === 'rename_wall') {
          const nextName = op.name?.trim()
          if (!nextName) return error(`Operation ${idx} (rename_wall): name is required.`)
          index = renameWall(index, targetRef.id, nextName)
          wallName = nextName
          indexChanged = true
          renamed = true
          summarySteps.push(`renamed wall to "${nextName}"`)
          results.push({ op: 'rename_wall', wall_id: targetRef.id, name: nextName })
          continue
        }

        if (op.op === 'set_background') {
          if (!op.background?.trim()) return error(`Operation ${idx} (set_background): background is required.`)
          currentBg = op.background.trim()
          bgChanged = true
          summarySteps.push(`changed background to "${currentBg}"`)
          results.push({ op: 'set_background', background: currentBg })
          continue
        }

        if (op.op === 'place') {
          const kind = op.kind
          if (!kind) return error(`Operation ${idx} (place): kind is required.`)

          if (kind === 'arrow') {
            if (!op.from_id || !op.to_id) return error(`Operation ${idx} (place arrow): from_id and to_id are required.`)
            const connected = connectWallItems(currentItems, resolveId(op.from_id), resolveId(op.to_id), {
              route: op.route,
              line: op.line,
              heads: op.heads,
              label: op.label ?? op.text,
              color: op.color,
              strokeWidth: op.stroke_width,
              layer: op.layer ?? undefined
            })
            if ('error' in connected) return error(connected.error)
            currentItems = connected.items
            if (op.temp_id) aliases.set(op.temp_id, connected.item.id)
            summarySteps.push('placed arrow')
            results.push({ op: 'place', item: describeWallItem(connected.item, () => undefined) })
            continue
          }

          if ((kind === 'card' || kind === 'doc') && !op.ref) {
            return error(`kind '${kind}' is a reference and needs ref: an item id for a card, a note title for a doc.`)
          }
          if (kind === 'card' && !getItemById(op.ref as string)) {
            return error(`No card with id '${op.ref}'. Use get_board or query_items to find one.`)
          }

          const itemLinkValue = op.link ? normalizeLinkInput(op.link) : null
          if (op.link && !itemLinkValue) {
            return error(`link '${op.link}' is neither a web address nor a wall:<wall_id>/<item_id> link.`)
          }
          const page = parseWallLink(itemLinkValue)
          if (kind === 'bookmark' && page?.type !== 'url') {
            return error("kind 'bookmark' needs link: a web address like https://example.com.")
          }

          let imageFields: Partial<WallItem> = {}
          if (kind === 'image') {
            const ingested = ingestImageInput(op.file_path, op.image_base64, op.mime_type)
            if ('error' in ingested) return error(ingested.error)
            const fitted = fitImageBox(ingested.naturalSize)
            imageFields = {
              ref: ingested.filename,
              ...(op.width !== undefined ? { width: Math.max(40, op.width) } : fitted ? { width: fitted.width } : {}),
              ...(op.height !== undefined ? { height: Math.max(32, op.height) } : fitted ? { height: fitted.height } : {}),
              ...(op.text ? { text: op.text } : {})
            }
          }

          const preview = kind === 'bookmark' && page?.type === 'url' ? await fetchLinkPreview(page.url) : null
          const bookmark: Partial<WallItem> =
            kind === 'bookmark' && page?.type === 'url'
              ? {
                  text: op.text || preview?.title || page.host,
                  ...(preview?.description ? { summary: preview.description } : {}),
                  ...(preview?.icon ? { ref: preview.icon } : {})
                }
              : {}

          const created = createWallItem(kind as WallItemKind, { x: op.x ?? 0, y: op.y ?? 0 }, currentItems, {
            ...(op.text ? { text: op.text } : {}),
            ...(op.ref ? { ref: op.ref } : {}),
            ...(op.width !== undefined ? { width: Math.max(40, op.width) } : {}),
            ...(op.height !== undefined ? { height: Math.max(32, op.height) } : {}),
            ...(op.color ? { color: op.color } : {}),
            ...(itemLinkValue ? { link: itemLinkValue } : {}),
            ...(kind === 'shape' && op.shape && op.shape !== 'rectangle' ? { shape: op.shape } : {}),
            ...bookmark,
            ...imageFields
          })

          const textAlign = op.align === 'left' || op.align === 'center' || op.align === 'right' ? op.align : undefined
          const styled = editWallItem([...currentItems, created], created.id, {
            align: textAlign,
            radius: op.radius,
            opacity: op.opacity,
            tags: op.tags,
            language: op.language,
            font: op.font as (typeof WALL_FONTS)[number] | undefined,
            fontSize: op.font_size ?? undefined,
            reactions: op.reactions,
            ...(op.border_color ? { borderColor: op.border_color } : {})
          })
          if ('error' in styled) return error(styled.error)
          currentItems = styled.items
          if (op.temp_id) aliases.set(op.temp_id, styled.item.id)
          summarySteps.push(`placed ${kind}`)
          results.push({ op: 'place', item: describeWallItem(styled.item, () => undefined) })
          continue
        }

        if (op.op === 'update') {
          if (!op.item_id) return error(`Operation ${idx} (update): item_id is required.`)
          const targetId = resolveId(op.item_id)
          const textAlign = op.align === 'left' || op.align === 'center' || op.align === 'right' ? op.align : undefined
          const updated = editWallItem(currentItems, targetId, {
            x: op.x,
            y: op.y,
            width: op.width,
            height: op.height,
            text: op.text,
            shape: op.shape,
            rotation: op.rotation,
            locked: op.locked,
            align: textAlign,
            radius: op.radius,
            opacity: op.opacity,
            tags: op.tags,
            font: op.font as (typeof WALL_FONTS)[number] | undefined,
            ...(op.font_size !== undefined ? { fontSize: op.font_size } : {}),
            strokeWidth: op.stroke_width,
            ...(op.layer !== undefined ? { layer: op.layer } : {}),
            reactions: op.reactions,
            ...(op.language !== undefined ? { language: op.language || null } : {}),
            ...(op.border_color !== undefined ? { borderColor: op.border_color || null } : {}),
            ...(op.color !== undefined ? { color: op.color || null } : {}),
            ...(op.link !== undefined ? { link: op.link || null } : {})
          })
          if ('error' in updated) return error(updated.error)
          currentItems = updated.items
          summarySteps.push(`updated ${updated.item.kind}`)
          results.push({ op: 'update', item: describeWallItem(updated.item, () => undefined) })
          continue
        }

        if (op.op === 'connect') {
          if (!op.from_id || !op.to_id) return error(`Operation ${idx} (connect): from_id and to_id are required.`)
          const connected = connectWallItems(currentItems, resolveId(op.from_id), resolveId(op.to_id), {
            route: op.route,
            line: op.line,
            heads: op.heads,
            label: op.label ?? op.text,
            color: op.color,
            strokeWidth: op.stroke_width,
            layer: op.layer ?? undefined
          })
          if ('error' in connected) return error(connected.error)
          currentItems = connected.items
          if (op.temp_id) aliases.set(op.temp_id, connected.item.id)
          summarySteps.push('connected items')
          results.push({ op: 'connect', item: describeWallItem(connected.item, () => undefined) })
          continue
        }

        if (op.op === 'remove') {
          const ids = resolveIds(op.item_ids)
          if (ids.length === 0) return error(`Operation ${idx} (remove): item_ids is required.`)
          const removed = removeWallItems(currentItems, ids)
          if ('error' in removed) return error(removed.error)
          currentBin = binRemoved(currentBin, removed.removed, removed.items, Date.now())
          currentItems = removed.items
          summarySteps.push(`removed ${removed.removed.length} item(s)`)
          results.push({ op: 'remove', removed: removed.removed.map(i => i.id) })
          continue
        }

        if (op.op === 'group' || op.op === 'ungroup') {
          const ids = resolveIds(op.item_ids)
          if (ids.length === 0) return error(`Operation ${idx} (${op.op}): item_ids is required.`)
          const missing = missingMessage(currentItems, ids)
          if (missing) return error(missing)
          const idSet = new Set(ids)
          const next = op.op === 'ungroup' ? ungroupItems(currentItems, idSet) : groupItems(currentItems, idSet)
          if (next === currentItems) {
            return error(
              op.op === 'ungroup'
                ? 'None of those items is in a group.'
                : 'Grouping needs two or more items that are neither arrows nor locked.'
            )
          }
          currentItems = next
          summarySteps.push(`${op.op}ed items`)
          results.push({
            op: op.op,
            items: currentItems.filter(i => idSet.has(i.id)).map(i => ({ id: i.id, group: i.group ?? null }))
          })
          continue
        }

        if (op.op === 'align' || op.op === 'distribute') {
          const ids = resolveIds(op.item_ids)
          if (ids.length < 2) return error(`Operation ${idx} (${op.op}): at least 2 item_ids are required.`)
          const missing = missingMessage(currentItems, ids)
          if (missing) return error(missing)
          const idSet = new Set(ids)
          const needed = op.op === 'align' ? 2 : 3
          if (alignableUnits(currentItems, idSet) < needed) {
            return error(`${op.op === 'align' ? 'Aligning' : 'Distributing'} needs ${needed} or more ungrouped/movable pieces.`)
          }
          if (op.op === 'align') {
            const alignDir = op.align === 'center' ? 'centre' : op.align
            if (!alignDir || !['left', 'centre', 'right', 'top', 'middle', 'bottom'].includes(alignDir)) {
              return error("Operation align requires align: 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'.")
            }
            currentItems = alignItems(currentItems, idSet, alignDir as 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom')
          } else {
            const distDir = op.distribute ?? 'horizontal'
            currentItems = distributeItems(currentItems, idSet, distDir)
          }
          summarySteps.push(`${op.op}ed items`)
          results.push({ op: op.op, items: currentItems.filter(i => idSet.has(i.id)).map(i => describeWallItem(i, () => undefined)) })
          continue
        }

        if (op.op === 'layer_order') {
          const ids = resolveIds(op.item_ids)
          if (ids.length === 0) return error(`Operation ${idx} (layer_order): item_ids is required.`)
          const missing = missingMessage(currentItems, ids)
          if (missing) return error(missing)
          if (op.order !== 'front' && op.order !== 'back') return error("layer_order requires order: 'front' | 'back'.")
          currentItems = op.order === 'front' ? bringToFront(currentItems, ids) : sendToBack(currentItems, ids)
          summarySteps.push(`moved ${ids.length} item(s) to ${op.order}`)
          results.push({ op: 'layer_order', order: op.order, item_ids: ids })
        }
      }

      if (indexChanged) {
        setSetting(idxKey, index)
      }
      const itemsChanged = currentItems !== originalDoc.items && JSON.stringify(currentItems) !== JSON.stringify(originalDoc.items)
      if (itemsChanged || currentBin !== originalDoc.bin || bgChanged) {
        setSetting(key, {
          ...originalDoc,
          background: currentBg,
          items: currentItems,
          ...(currentBin ? { bin: currentBin } : {})
        })
      }

      const undo: McpUndoAction[] = []
      const targetCreated = createdWallIds.includes(targetRef.id)
      if (itemsChanged && !targetCreated) {
        undo.push(...undoFor(key, originalDoc.items, currentItems))
      }
      if ((renamed || bgChanged) && !targetCreated) {
        undo.push({
          kind: 'restore_wall_meta',
          indexKey: idxKey,
          docKey: key,
          wallId: targetRef.id,
          ...(renamed ? { name: originalName } : {}),
          ...(bgChanged ? { background: originalBg } : {})
        })
      }
      for (const wallId of createdWallIds) {
        undo.push({ kind: 'delete_wall', indexKey: idxKey, docKey: wallDocKey(ctx, wallId), wallId })
      }

      recordMcpActivity('edit_wall', ctx, `Wall "${wallName}": ${summarySteps.join(', ')}`, undo.length > 0 ? undo : null)
      notifyRenderer()
      return json({
        wall: { id: targetRef.id, name: wallName, background: currentBg },
        results
      })
    }
  )

  mcp.registerTool(
    'read_wall_image',
    {
      title: 'Read Wall Image',
      description:
        'Read an image stored on a wall (by item_id from get_wall, or directly by media filename) and return it as an image content block.',
      inputSchema: {
        context: z.string().optional().describe('Workspace slug (required when resolving by item_id).'),
        wall_id: z.string().optional().describe('Target wall id (defaults to active wall).'),
        item_id: z.string().optional().describe('Wall image/bookmark item id from get_wall.'),
        filename: z.string().optional().describe('Direct media filename (ref) if already known.')
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ context: ctx, wall_id, item_id, filename }) => {
      let targetFile = filename?.trim()

      if (!targetFile) {
        if (!item_id || !ctx) return error('Provide either filename, or both context and item_id.')
        const bad = validateWorkspace(ctx)
        if (bad) return error(bad)

        let wall: { id: string; name: string; key: string }
        try {
          wall = resolveWall(ctx, wall_id)
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err))
        }

        const doc = readWallDoc(wall.key)
        const item = doc.items.find(i => i.id === item_id)
        if (!item) return error(`No item '${item_id}' on wall '${wall.name}'.`)
        if (item.kind !== 'image' && item.kind !== 'bookmark') {
          return error(`Item '${item_id}' has kind '${item.kind}', not an image.`)
        }
        targetFile = item.previewImage || item.ref
        if (!targetFile) return error(`Item '${item_id}' has no attached image file.`)
      }

      const buf = readMediaBuffer(targetFile)
      if (!buf) return error(`Media file "${targetFile}" was not found on disk.`)
      if (buf.length > MAX_READ_IMAGE_BYTES) {
        return error(`Media file "${targetFile}" is ${(buf.length / (1024 * 1024)).toFixed(1)} MB, exceeding the 5 MB transfer limit.`)
      }

      const ext = extname(targetFile).toLowerCase()
      const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream'

      if (ext === '.svg') {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ filename: targetFile, mimeType, bytes: buf.length }) },
            { type: 'text' as const, text: buf.toString('utf8') }
          ]
        }
      }

      const size = measureImageSize(buf, ext)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ filename: targetFile, mimeType, bytes: buf.length, ...(size ?? {}) })
          },
          { type: 'image' as const, data: buf.toString('base64'), mimeType }
        ]
      }
    }
  )
}
