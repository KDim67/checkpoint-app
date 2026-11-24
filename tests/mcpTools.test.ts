import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { closeDb, createItem, getDb, initDb } from '../src/main/db'
import { listMcpActivity, undoMcpActivity } from '../src/main/mcpActivity'
import { buildMcpServer } from '../src/main/mcpServer'
import { registerItemTools } from '../src/main/mcp/tools/items'
import { registerSubtaskTools } from '../src/main/mcp/tools/subtasks'
import { registerWallTools } from '../src/main/mcp/tools/walls'
import { registerOrganisationTools } from '../src/main/mcp/tools/organisation'
import { registerReferenceTools } from '../src/main/mcp/tools/reference'
import { registerTrackingTools } from '../src/main/mcp/tools/tracking'
import { registerBoardTools } from '../src/main/mcp/tools/board'

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

// valid 200x100 PNG header + minimal payload bytes for measureImageSize fallback
function makePng(width = 200, height = 100): Buffer {
  const buf = Buffer.alloc(32)
  buf.writeUInt32BE(0x89504e47, 0)
  buf.writeUInt32BE(0x0d0a1a0a, 4)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

function collectTools(): Record<string, { spec: { annotations?: Record<string, unknown> }; handler: Handler }> {
  const map: Record<string, { spec: { annotations?: Record<string, unknown> }; handler: Handler }> = {}
  const fake = {
    registerTool: (name: string, spec: { annotations?: Record<string, unknown> }, handler: Handler) => {
      map[name] = { spec, handler }
    }
  } as unknown as McpServer

  registerBoardTools(fake)
  registerItemTools(fake)
  registerWallTools(fake)
  registerOrganisationTools(fake)
  registerSubtaskTools(fake)
  registerReferenceTools(fake)
  registerTrackingTools(fake)
  return map
}

const parseJson = (res: ToolResult): Record<string, unknown> =>
  JSON.parse(res.content[0].text ?? '{}') as Record<string, unknown>

let dir: string
let tools: ReturnType<typeof collectTools>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-mcp-tools-'))
  initDb(dir)
  tools = collectTools()
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('MCP server registration & annotations', () => {
  it('builds consolidated server with 22 tools and valid annotations', () => {
    const server = buildMcpServer() as unknown as { _registeredTools: Record<string, { annotations?: { readOnlyHint?: boolean } }> }
    const names = Object.keys(server._registeredTools)
    expect(names).toHaveLength(22)
    expect(names).toContain('edit_wall')
    expect(names).toContain('read_wall_image')
    expect(names).toContain('query_items')
    expect(server._registeredTools.get_wall.annotations?.readOnlyHint).toBe(true)
    expect(server._registeredTools.edit_wall.annotations?.readOnlyHint).toBe(false)
  })

  it('excludes write tools when built in readOnly mode', () => {
    const server = buildMcpServer({ readOnly: true }) as unknown as {
      _registeredTools: Record<string, { annotations?: { readOnlyHint?: boolean } }>
    }
    const entries = Object.entries(server._registeredTools)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every(([, tool]) => tool.annotations?.readOnlyHint === true)).toBe(true)
    expect(server._registeredTools.edit_wall).toBeUndefined()
    expect(server._registeredTools.get_wall).toBeDefined()
    expect(server._registeredTools.read_wall_image).toBeDefined()
  })
})

describe('consolidated items, views, subtasks, and error signaling', () => {
  it('returns isError=true for missing items, unknown workspaces, and bad subtasks', async () => {
    createItem(getDb(), {
      type: 'card',
      context: 'work',
      title: 'Existing',
      body: '',
      status: 'open',
      priority: 2,
      position: 0,
      due_at: null,
      metadata: '{}'
    })

    const badCtx = await tools.query_items.handler({ context: 'typo-ws' })
    expect(badCtx.isError).toBe(true)
    expect(badCtx.content[0].text).toContain('Available workspaces: default, work')

    const missingSub = await tools.manage_subtasks.handler({ action: 'set_done', id: 'nope', done: true })
    expect(missingSub.isError).toBe(true)

    const missingRel = await tools.manage_relations.handler({ action: 'get', itemId: 'nope' })
    expect(missingRel.isError).toBe(true)
  })

  it('creates item, adds/toggles subtask, and queries with includeSubtasks', async () => {
    const created = parseJson(
      await tools.create_item.handler({ context: 'work', type: 'task', title: 'Ship 1.1.9', priority: 3 })
    ).created as { id: string }

    const sub = parseJson(
      await tools.manage_subtasks.handler({ action: 'add', id: created.id, title: 'Polish MCP' })
    ).created as { id: string }

    const doneRes = await tools.manage_subtasks.handler({ action: 'set_done', id: sub.id, done: true })
    expect(doneRes.isError).toBeUndefined()

    const queried = parseJson(
      await tools.query_items.handler({ context: 'work', query: 'Ship', includeSubtasks: true })
    )
    const items = queried.items as Array<{ subtasks?: Array<{ title: string; done: boolean }> }>
    expect(items[0].subtasks).toEqual([{ id: sub.id, title: 'Polish MCP', done: true }])
  })
})

describe('wall batch editing, image drop, and image reading', () => {
  it('places images via base64 and file_path, connects items with temp_id, reads image back, and undoes atomically', async () => {
    const localPngPath = join(dir, 'sample.png')
    writeFileSync(localPngPath, makePng(400, 200))

    const base64Data = makePng(160, 80).toString('base64')
    const editRes = await tools.edit_wall.handler({
      context: 'work',
      operations: [
        { op: 'place', temp_id: 'img1', kind: 'image', image_base64: `data:image/png;base64,${base64Data}`, x: 100, y: 100 },
        { op: 'place', temp_id: 'img2', kind: 'image', file_path: localPngPath, x: 500, y: 100 },
        { op: 'connect', from_id: 'img1', to_id: 'img2', label: 'ref', stroke_width: 4, layer: 'front' },
        { op: 'update', item_id: 'img1', reactions: { '🔥': 2 } }
      ]
    })
    expect(editRes.isError).toBeUndefined()

    const wallData = parseJson(await tools.get_wall.handler({ context: 'work' }))
    const wallItems = wallData.items as Array<Record<string, unknown>>
    expect(wallItems).toHaveLength(3)

    const img1 = wallItems.find(i => i.x === 100 - 160 / 2)
    const img2 = wallItems.find(i => i.width === 320) // 400x200 scaled by fitImageBox(320) => 320x160
    const arrow = wallItems.find(i => i.kind === 'arrow')
    expect(img1).toBeDefined()
    expect(img2).toBeDefined()
    expect(arrow).toBeDefined()
    expect(img1?.width).toBe(160)
    expect(img1?.height).toBe(80)
    expect(img1?.reactions).toEqual({ '🔥': 2 })
    expect(img2?.height).toBe(160)
    expect(arrow).toMatchObject({ stroke_width: 4, layer: 'front', text: 'ref' })

    const readRes = await tools.read_wall_image.handler({ context: 'work', item_id: img1?.id as string })
    expect(readRes.isError).toBeUndefined()
    expect(readRes.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png', data: base64Data })

    // single undo reverts the entire batch cleanly
    const [entry] = listMcpActivity(5)
    expect(entry.tool).toBe('edit_wall')
    expect(undoMcpActivity(entry.id)).toEqual({ ok: true })
    const afterUndo = parseJson(await tools.get_wall.handler({ context: 'work' }))
    expect(afterUndo.items).toHaveLength(0)
  })

  it('rejects unsupported image extensions with isError=true', async () => {
    const badPath = join(dir, 'notes.txt')
    writeFileSync(badPath, 'not an image')
    const res = await tools.edit_wall.handler({
      context: 'work',
      operations: [{ op: 'place', kind: 'image', file_path: badPath }]
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('Unsupported image format')
  })

  it('undoes create_wall, rename_wall, and set_background atomically', async () => {
    // create a wall and populate it in one batch, then undo deletes the whole wall
    const createdRes = parseJson(
      await tools.edit_wall.handler({
        context: 'work',
        operations: [
          { op: 'create_wall', name: 'Architecture' },
          { op: 'set_background', background: 'canvas-dark' },
          { op: 'place', kind: 'note', text: 'API' }
        ]
      })
    )
    const createdWallId = (createdRes.wall as { id: string }).id
    let list = parseJson(await tools.get_wall.handler({ context: 'work', list_only: true })).walls as Array<{ id: string; name: string }>
    expect(list.some(w => w.id === createdWallId && w.name === 'Architecture')).toBe(true)

    expect(undoMcpActivity(listMcpActivity(5)[0].id)).toEqual({ ok: true })
    list = parseJson(await tools.get_wall.handler({ context: 'work', list_only: true })).walls as Array<{ id: string; name: string }>
    expect(list.some(w => w.id === createdWallId)).toBe(false)

    // rename + change background on default wall, then undo restores both
    await tools.edit_wall.handler({
      context: 'work',
      operations: [
        { op: 'rename_wall', name: 'Renamed' },
        { op: 'set_background', background: '#112233' }
      ]
    })
    let current = parseJson(await tools.get_wall.handler({ context: 'work' })).wall as { name: string; background: string }
    expect(current).toMatchObject({ name: 'Renamed', background: '#112233' })

    expect(undoMcpActivity(listMcpActivity(5)[0].id)).toEqual({ ok: true })
    current = parseJson(await tools.get_wall.handler({ context: 'work' })).wall as { name: string; background: string }
    expect(current.name).toBe('Wall')
    expect(current.background).not.toBe('#112233')
  })
})
