/**
 * Model Context Protocol server for Checkpoint.
 *
 * Exposes workspaces, cards, tasks, notes and board configuration to MCP
 * clients over a loopback HTTP endpoint, for reading and writing, while the app
 * is running.
 *
 * It lives in the main process out of necessity rather than preference:
 * better-sqlite3 is compiled against Electron's ABI, so a plain Node process
 * cannot open checkpoint.db at all (verified, it fails with ERR_DLOPEN_FAILED).
 * Hosting here also means every tool calls the same `db.ts` functions the app
 * itself uses, inheriting their validation, sync tombstones and position
 * rebalancing instead of reimplementing them against raw SQL.
 *
 * Deliberately a separate server from the webhook gateway: the gateway is
 * unauthenticated with a wildcard CORS policy, which is defensible for a
 * write-only "append a log line" endpoint and completely wrong for a surface
 * that can read every note.
 */

import http from 'http'
import crypto from 'crypto'
import { randomUUID } from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
// 'zod/v3', not 'zod'. Zod 3.25 ships the v3 and v4 APIs under separate
// subpaths, and the SDK's schema types are declared against `zod/v3`. Importing
// the package root yields a nominally different ZodTypeAny, which fails to
// satisfy the SDK's AnySchema and buries the real errors under
// "type instantiation is excessively deep".
import { z } from 'zod/v3'
import {
  getDb,
  getSetting,
  setSetting,
  getContextSlugs,
  getItemsPaginated,
  getItemById,
  createItem,
  updateItem,
  searchItems,
  queryTasks,
  getAllTags
} from './db'
import { listNotes, readNote, writeNote, searchNotes } from './notesFsService'
import {
  normalizeBoardConfig,
  migrateLegacy,
  boardConfigKey,
  legacyColumnsKey,
  legacyBackgroundKey,
  legacyArchivedKey,
  type BoardConfig
} from '../shared/boardModel'
import { applyConfigOps, normalizeConfigUpdate } from '../shared/boardOps'
import type { CreateItemPayload, Item } from '../shared/types'

export const MCP_DEFAULT_PORT = 9990
const TOKEN_SETTING_KEY = 'mcp_auth_token'

/** Host header values accepted. Anything else is a rebinding attempt. */
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

let server: http.Server | null = null
let activePort: number | null = null

/** Set by the owner so writes can nudge the open window to reload. */
let onDataChanged: (() => void) | null = null

export function setMcpDataChangedHandler(fn: (() => void) | null): void {
  onDataChanged = fn
}

// Token

/**
 * Returns the bearer token, generating one on first use.
 *
 * The key is registered in secureSettings' SECRET_SETTING_KEYS, so it is
 * encrypted at rest by the OS keychain exactly like the AI provider keys, 
 * a token granting full read/write over someone's workspace should not sit in
 * plaintext next to them.
 */
export function getOrCreateMcpToken(): string {
  const existing = getSetting<string>(TOKEN_SETTING_KEY, '')
  if (existing) return existing
  const token = crypto.randomBytes(32).toString('hex')
  setSetting(TOKEN_SETTING_KEY, token)
  return token
}

export function regenerateMcpToken(): string {
  const token = crypto.randomBytes(32).toString('hex')
  setSetting(TOKEN_SETTING_KEY, token)
  return token
}

// Request guards

/** Strips the port so `localhost:9990` and `localhost` both resolve. */
function hostnameOf(headerValue: string | undefined): string {
  if (!headerValue) return ''
  const value = headerValue.trim()
  // IPv6 literals are bracketed, and their colons must not be split on.
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1).toLowerCase()
  return value.split(':')[0].toLowerCase()
}

/**
 * Defence in depth against DNS rebinding. The bearer token is the primary
 * control, the classic attack targets *unauthenticated* localhost servers, and
 * a page cannot read a token it was never given, but a page should not get as
 * far as presenting credentials in the first place.
 *
 * The SDK's own protection moved to Express middleware in 1.30 and is
 * deprecated on the Node transport, so it is done here rather than pulling a
 * web framework into the main process for one endpoint.
 */
function isOriginAllowed(req: http.IncomingMessage): boolean {
  if (!ALLOWED_HOSTNAMES.has(hostnameOf(req.headers.host))) return false

  const origin = req.headers.origin
  // A non-browser client sends no Origin at all; that is the normal case.
  if (!origin) return true
  try {
    return ALLOWED_HOSTNAMES.has(new URL(origin).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Constant-time compare so the token cannot be recovered by timing. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return false
  return tokenMatches(header.slice('Bearer '.length).trim(), getOrCreateMcpToken())
}

// Board config access (main-process side)

/**
 * Reads a board document, running the same legacy migration the renderer does.
 * Shares `src/shared/boardModel` with the renderer and the AI action blocks, so
 * there is exactly one definition of what a board's configuration means.
 */
function readBoardConfig(context: string): BoardConfig {
  const stored = getSetting<unknown>(boardConfigKey(context), null)
  if (stored !== null && stored !== undefined && stored !== '') {
    return normalizeBoardConfig(stored)
  }
  return migrateLegacy(
    getSetting<unknown>(legacyColumnsKey(context), null),
    getSetting<unknown>(legacyBackgroundKey(context), null),
    getSetting<unknown>(legacyArchivedKey(context), null)
  )
}

function writeBoardConfig(context: string, config: BoardConfig): void {
  setSetting(boardConfigKey(context), normalizeBoardConfig(config))
}

// Tool helpers

/** Every tool returns text; structured payloads go out as pretty JSON. */
function json(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function text(value: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: value }] }
}

/** Trimmed for transport: full bodies would blow the context on a large board. */
function summarizeItem(item: Item): Record<string, unknown> {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body.length > 500 ? `${item.body.slice(0, 500)}…` : item.body,
    status: item.status,
    priority: item.priority,
    due_at: item.due_at,
    updated_at: item.updated_at,
    tags: (item.tags ?? []).map(t => t.name)
  }
}

function notifyRenderer(): void {
  try {
    onDataChanged?.()
  } catch (err) {
    console.error('[mcp] Failed to notify renderer:', err)
  }
}

// Server construction

function buildMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'checkpoint', version: '1.0.0' })

  // Every tool takes an explicit workspace rather than reading the app's active
  // context: an agent's target must not silently change because the user
  // clicked something in the UI mid-task.
  const context = z.string().describe('Workspace slug. Use list_workspaces to discover valid values.')

  // Read

  mcp.registerTool(
    'list_workspaces',
    { description: 'List every workspace (context) in Checkpoint.' },
    async () => json({ workspaces: getContextSlugs() })
  )

  mcp.registerTool(
    'get_board',
    {
      description: 'Get a workspace\'s Kanban board: its column configuration and the cards in each column.',
      inputSchema: { context }
    },
    async ({ context: ctx }) => {
      const config = readBoardConfig(ctx)
      const cards = getItemsPaginated(ctx, 'card', 1, 1000).items
      return json({
        context: ctx,
        background: config.background,
        swimlanes: config.swimlanes,
        cardDisplay: config.cardDisplay,
        columns: config.columns.map(col => ({
          id: col.id,
          name: col.name,
          wipLimit: col.wipLimit,
          color: col.color,
          sort: col.sort ?? 'manual',
          collapsed: col.collapsed ?? false,
          description: col.description,
          cards: cards.filter(c => c.status === col.id).map(summarizeItem)
        }))
      })
    }
  )

  mcp.registerTool(
    'search_items',
    {
      description: 'Full-text search across logs, cards and tasks.',
      inputSchema: {
        query: z.string().describe('Search text.'),
        context: z.string().optional().describe('Restrict to one workspace.'),
        type: z.enum(['log', 'card', 'task']).optional(),
        limit: z.number().int().positive().max(200).optional()
      }
    },
    async ({ query, context: ctx, type, limit }) =>
      json({
        results: searchItems({ query, context: ctx, type, page: 0, pageSize: limit ?? 25 })
          .items.map(summarizeItem)
      })
  )

  mcp.registerTool(
    'query_tasks',
    {
      description: 'Filtered query over the structured backlog.',
      inputSchema: {
        context,
        query: z.string().optional(),
        status: z.array(z.string()).optional(),
        priority: z.array(z.number().int()).optional(),
        sortBy: z.string().optional(),
        sortDesc: z.boolean().optional(),
        pageSize: z.number().int().positive().max(200).optional()
      }
    },
    async ({ context: ctx, ...params }) =>
      json({
        tasks: queryTasks(getDb(), ctx, {
          ...params,
          page: 1,
          pageSize: params.pageSize ?? 50
        }).items.map(summarizeItem)
      })
  )

  mcp.registerTool(
    'list_notes',
    { description: 'List all markdown notes with their metadata.' },
    async () => json({ notes: await listNotes() })
  )

  mcp.registerTool(
    'read_note',
    {
      description: 'Read one markdown note by title.',
      inputSchema: { title: z.string() }
    },
    async ({ title }) => text(await readNote(title))
  )

  mcp.registerTool(
    'search_notes',
    {
      description: 'Search note contents.',
      inputSchema: { query: z.string() }
    },
    async ({ query }) => json({ results: await searchNotes(query) })
  )

  mcp.registerTool(
    'list_tags',
    { description: 'List every tag defined in Checkpoint.' },
    async () => json({ tags: getAllTags() })
  )

  // Write

  mcp.registerTool(
    'create_item',
    {
      description: 'Create a log entry, Kanban card or backlog task.',
      inputSchema: {
        context,
        type: z.enum(['log', 'card', 'task']),
        title: z.string(),
        body: z.string().optional(),
        status: z.string().optional().describe('Column id for cards. Defaults to the first column.'),
        priority: z.number().int().min(0).max(3).optional(),
        due_at: z.number().nullable().optional().describe('Epoch milliseconds.')
      }
    },
    async ({ context: ctx, type, title, body, status, priority, due_at }) => {
      const config = readBoardConfig(ctx)
      const payload: CreateItemPayload = {
        type,
        context: ctx,
        title,
        body: body ?? '',
        // A card with a status no column owns is invisible on the board, so an
        // unspecified or unknown status resolves to the first real column.
        status: status && config.columns.some(c => c.id === status)
          ? status
          : type === 'card' ? config.columns[0].id : 'open',
        priority: (priority ?? 2) as Item['priority'],
        position: Date.now(),
        due_at: due_at ?? null,
        metadata: '{}'
      }
      const created = createItem(getDb(), payload)
      notifyRenderer()
      return json({ created: summarizeItem(created) })
    }
  )

  mcp.registerTool(
    'update_item',
    {
      description: 'Update an existing log, card or task by id.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
        status: z.string().optional().describe('Move to this column id.'),
        priority: z.number().int().min(0).max(3).optional(),
        due_at: z.number().nullable().optional()
      }
    },
    async ({ id, ...patch }) => {
      if (!getItemById(id)) return text(`No item with id "${id}".`)
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      if (Object.keys(clean).length === 0) return text('Nothing to update.')
      const updated = updateItem(getDb(), id, clean as Partial<Item>)
      notifyRenderer()
      return json({ updated: summarizeItem(updated) })
    }
  )

  mcp.registerTool(
    'configure_board',
    {
      description:
        'Change a board\'s configuration: add, rename, recolour, reorder, WIP-limit, collapse or delete columns; ' +
        'set the background, priority swimlanes, or which fields appear on cards. Does not change card contents.',
      inputSchema: {
        context,
        operations: z
          .array(z.record(z.unknown()))
          .describe(
            'Operations. Each has "op", one of add_column, update_column, delete_column, reorder_columns, ' +
            'set_background, set_swimlanes, set_card_display, plus that op\'s fields. ' +
            'Column ops take "target" (a column name or id).'
          )
      }
    },
    async ({ context: ctx, operations }) => {
      // Reuses the assistant's normalizer, so an MCP client gets the same
      // tolerance for aliases and loose types that a local model gets.
      const normalized = normalizeConfigUpdate({ operations })
      if (!normalized) return text('No valid operations found. Check the "op" values.')

      const config = readBoardConfig(ctx)
      const applied = applyConfigOps(config, normalized.operations)

      // Deleting a column would strand its cards under a status no column
      // claims; they follow to the first surviving column, matching the board.
      let movedCards = 0
      for (const move of applied.cardMoves) {
        const affected = getItemsPaginated(ctx, 'card', 1, 1000).items
          .filter(i => i.status === move.fromColumn)
        for (const card of affected) {
          updateItem(getDb(), card.id, { status: move.toColumn })
          movedCards++
        }
      }

      writeBoardConfig(ctx, applied.next)
      notifyRenderer()
      return json({
        applied: applied.summary,
        skipped: applied.skipped,
        movedCards,
        columns: applied.next.columns.map(c => ({ id: c.id, name: c.name, wipLimit: c.wipLimit }))
      })
    }
  )

  mcp.registerTool(
    'write_note',
    {
      description: 'Create or overwrite a markdown note.',
      inputSchema: {
        title: z.string(),
        content: z.string(),
        oldTitle: z.string().optional().describe('Set when renaming an existing note.')
      }
    },
    async ({ title, content, oldTitle }) => {
      await writeNote(title, content, oldTitle)
      notifyRenderer()
      return text(`Saved note "${title}".`)
    }
  )

  return mcp
}

// Lifecycle

export function startMcpServer(requestedPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(activePort ?? requestedPort)
      return
    }

    const port = requestedPort > 0 ? requestedPort : MCP_DEFAULT_PORT

    const httpServer = http.createServer(async (req, res) => {
      // Order matters: reject on host before touching the body or the token, so
      // a rebinding attempt learns nothing and costs nothing.
      if (!isOriginAllowed(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }
      if (!isAuthorized(req)) {
        // Deliberately vague: distinguishing "no token" from "wrong token"
        // tells an attacker which half they got right.
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      try {
        // Stateless: a desktop process runs for days, and a session map is a
        // leak waiting to happen for what is a single local user.
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        const mcp = buildMcpServer()
        res.on('close', () => {
          transport.close().catch(() => {})
          mcp.close().catch(() => {})
        })
        await mcp.connect(transport)
        await transport.handleRequest(req, res)
      } catch (err) {
        console.error('[mcp] Request failed:', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal error' }))
        }
      }
    })

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      server = null
      activePort = null
      // Surfaced rather than silently rebinding: a client config pointing at a
      // port the server did not get is worse than a visible failure.
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use. Choose another port in Settings.`)
          : err
      )
    })

    httpServer.listen(port, '127.0.0.1', () => {
      server = httpServer
      activePort = port
      console.log(`[mcp] MCP server listening on http://127.0.0.1:${port}/`)
      resolve(port)
    })
  })
}

export async function stopMcpServer(): Promise<void> {
  if (!server) return
  await new Promise<void>(resolve => {
    server?.close(() => resolve())
    server = null
    activePort = null
  })
  console.log('[mcp] MCP server stopped.')
}

export async function toggleMcpServer(active: boolean, port: number): Promise<number | null> {
  await stopMcpServer()
  if (!active) return null
  return startMcpServer(port)
}

export function getMcpPort(): number | null {
  return activePort
}

/** Unused today; kept so a future tool can mint per-client session ids. */
export const newSessionId = randomUUID
