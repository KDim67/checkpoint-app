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
  getAllTags,
  createTag,
  getRelations,
  createRelation,
  getFocusSessions,
  getClipboardHistory,
  getRecurrences,
  deleteRecurrence,
  getSubtasks,
  insertSubtask,
  updateSubtask
} from './db'
import { listNotes, readNote, writeNote, searchNotes } from './notesFsService'
import { listCheatsheets, getCheatsheetText, searchCheatsheets } from './cheatsheetService'
import { checkRepo, getGitStatus, getGitLog } from './gitService'
import { getMemories, searchMemories } from './memoryService'
import { getAnalyticsData } from './analyticsService'
import {
  normalizeBoardConfig,
  migrateLegacy,
  boardConfigKey,
  legacyColumnsKey,
  legacyBackgroundKey,
  legacyArchivedKey,
  legacySwimlanesKey,
  type BoardConfig
} from '../shared/boardModel'
import { applyConfigOps, normalizeConfigUpdate } from '../shared/boardOps'
import type { CreateItemPayload, Item } from '../shared/types'
import { recordMcpActivity } from './mcpActivity'
import { createRecurrence, ruleFromRow } from './recurrenceService'
import { describeRule } from '../shared/recurrence'
import { normalizeSubtasks, computeProgress, nextPosition } from '../shared/subtasks'
import {
  BUILT_IN_VIEWS,
  normalizeSavedViews,
  toQueryParams,
  describeView
} from '../shared/savedViews'
import { shorten, type McpUndoAction } from '../shared/mcpActivity'
import { MCP_DEFAULT_PORT } from '../shared/ports'

// Re-exported so the dynamic importers in index.ts keep resolving it here.
export { MCP_DEFAULT_PORT }
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
    getSetting<unknown>(legacyArchivedKey(context), null),
    getSetting<unknown>(legacySwimlanesKey(context), null)
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

/**
 * Guards the memory tools.
 *
 * memoryService prepares its statements in initMemoryIpc() at app boot and
 * getMemories() dereferences them without checking, so calling it before that
 * has run throws on an undefined statement. That should never happen in the
 * packaged app, boot order puts memory init first, but a failed init would
 * otherwise surface to an agent as an opaque crash rather than a usable answer.
 */
function withMemoryStore(fn: () => { content: { type: 'text'; text: string }[] }): {
  content: { type: 'text'; text: string }[]
} {
  try {
    return fn()
  } catch (err) {
    console.error('[mcp] Memory store unavailable:', err)
    return text('The assistant memory store is not available yet. Try again once Checkpoint has finished starting.')
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
      recordMcpActivity(
        'create_item',
        ctx,
        `Created ${type} "${shorten(title)}"`,
        [{ kind: 'delete_item', id: created.id }]
      )
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

      // Captured before the write: afterwards the old values are gone, and only
      // the fields actually being changed are worth restoring.
      const before = getItemById(id)
      const restored: Record<string, unknown> = {}
      if (before) {
        for (const key of Object.keys(clean)) {
          restored[key] = (before as unknown as Record<string, unknown>)[key]
        }
      }

      const updated = updateItem(getDb(), id, clean as Partial<Item>)
      recordMcpActivity(
        'update_item',
        before?.context ?? null,
        `Updated "${shorten(before?.title ?? id)}" (${Object.keys(clean).join(', ')})`,
        before ? [{ kind: 'restore_item', id, fields: restored }] : null
      )
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
      recordMcpActivity(
        'configure_board',
        ctx,
        applied.summary.length > 0
          ? `Board: ${applied.summary.join('; ')}`
          : 'Board configuration changed',
        // Cards moved off a deleted column are not restored by the inverse, the
        // column comes back, but which cards sat in it is not recoverable from
        // the config alone, so undo is only offered when nothing moved.
        applied.inverse.length > 0 && movedCards === 0
          ? [{ kind: 'board_ops', context: ctx, operations: applied.inverse }]
          : null
      )
      notifyRenderer()
      return json({
        applied: applied.summary,
        skipped: applied.skipped,
        movedCards,
        columns: applied.next.columns.map(c => ({ id: c.id, name: c.name, wipLimit: c.wipLimit }))
      })
    }
  )

  // Subtasks
  // The reason subtasks became rows: as checkboxes buried in a body they could
  // not be listed, counted, or ticked off by anything but a human reading prose.

  mcp.registerTool(
    'list_subtasks',
    {
      description: 'List the subtasks of a card or task, with how many are done.',
      inputSchema: { id: z.string().describe('The parent item id.') }
    },
    async ({ id }) => {
      if (!getItemById(id)) return text('No item with id "' + id + '".')
      const subtasks = normalizeSubtasks(getSubtasks(id))
      const progress = computeProgress(subtasks)
      return json({
        progress: { done: progress.done, total: progress.total },
        subtasks: subtasks.map(s => ({ id: s.id, title: s.title, done: s.done }))
      })
    }
  )

  mcp.registerTool(
    'add_subtask',
    {
      description: 'Add a subtask to a card or task. Use this to break work down rather than editing the description.',
      inputSchema: {
        id: z.string().describe('The parent item id.'),
        title: z.string().min(1)
      }
    },
    async ({ id, title }) => {
      const parent = getItemById(id)
      if (!parent) return text('No item with id "' + id + '".')

      const subtaskId = randomUUID()
      insertSubtask({
        id: subtaskId,
        item_id: id,
        title: title.trim(),
        done: 0,
        position: nextPosition(normalizeSubtasks(getSubtasks(id))),
        created_at: Date.now()
      })
      recordMcpActivity(
        'add_subtask',
        parent.context,
        'Added subtask "' + shorten(title) + '" to "' + shorten(parent.title) + '"',
        [{ kind: 'delete_subtask', id: subtaskId }]
      )
      notifyRenderer()
      return json({ created: { id: subtaskId, title: title.trim() } })
    }
  )

  mcp.registerTool(
    'set_subtask_done',
    {
      description: 'Tick or untick a subtask.',
      inputSchema: { id: z.string().describe('The subtask id.'), done: z.boolean() }
    },
    async ({ id, done }) => {
      updateSubtask(id, { done })
      recordMcpActivity(
        'set_subtask_done',
        null,
        (done ? 'Completed' : 'Reopened') + ' a subtask',
        [{ kind: 'set_subtask_done', id, done: !done }]
      )
      notifyRenderer()
      return text('Subtask marked ' + (done ? 'done' : 'not done') + '.')
    }
  )

  // Saved views
  // The point of naming a filter is that it can then be asked for by name, so an
  // agent gets the same vocabulary the user does rather than restating a query.

  mcp.registerTool(
    'list_views',
    { description: 'List saved task views, named filters like "Overdue" or "High priority".' },
    async () => {
      const stored = getSetting<unknown>('saved_views', null)
      const views = [...BUILT_IN_VIEWS, ...normalizeSavedViews(stored)]
      return json({
        views: views.map(v => ({ id: v.id, name: v.name, describes: describeView(v), builtIn: v.builtIn === true }))
      })
    }
  )

  mcp.registerTool(
    'query_view',
    {
      description:
        'Run a saved view and return the tasks it selects. Use list_views first to see what exists. ' +
        'Relative dates resolve when the view runs, so "Overdue" always means overdue now.',
      inputSchema: {
        context,
        view: z.string().describe('The view id or its exact name.'),
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ context: ctx, view: wanted, limit }) => {
      const stored = getSetting<unknown>('saved_views', null)
      const views = [...BUILT_IN_VIEWS, ...normalizeSavedViews(stored)]
      const match =
        views.find(v => v.id === wanted) ??
        views.find(v => v.name.toLowerCase() === wanted.trim().toLowerCase())
      if (!match) {
        return text(`No view called "${wanted}". Available: ${views.map(v => v.name).join(', ')}.`)
      }

      const params = { ...toQueryParams(match, Date.now()), page: 1, pageSize: limit ?? 50 }
      const result = queryTasks(getDb(), ctx, params)
      return json({
        view: { id: match.id, name: match.name, describes: describeView(match) },
        total: result.total,
        tasks: result.items.map(summarizeItem)
      })
    }
  )

  // Recurring work

  mcp.registerTool(
    'list_recurrences',
    {
      description: 'List repeating work rules for a workspace, with when each next fires.',
      inputSchema: { context }
    },
    async ({ context: ctx }) =>
      json({
        recurrences: getRecurrences(ctx).map(row => {
          const rule = ruleFromRow(row)
          return {
            id: row.id,
            title: row.title,
            type: row.type,
            active: row.active === 1,
            nextDue: row.next_due,
            repeats: rule ? describeRule(rule) : 'unreadable'
          }
        })
      })
  )

  mcp.registerTool(
    'create_recurrence',
    {
      description:
        'Set up work that repeats. Creates one item at a time: the next occurrence appears only ' +
        'once the previous one is done, so an untouched daily task never piles up.',
      inputSchema: {
        context,
        title: z.string().min(1),
        body: z.string().optional(),
        type: z.enum(['card', 'task']).optional().describe('Defaults to task.'),
        priority: z.number().int().min(0).max(3).optional(),
        freq: z.enum(['daily', 'weekly', 'monthly']),
        interval: z.number().int().min(1).optional().describe('Every N periods. Defaults to 1.'),
        byWeekday: z
          .array(z.number().int().min(0).max(6))
          .optional()
          .describe('Weekly rules only. 0 is Sunday. Omit to repeat on the start day.'),
        startAt: z.number().describe('Epoch milliseconds of the first occurrence, including its time of day.'),
        untilAt: z.number().nullable().optional().describe('Epoch milliseconds. Omit to repeat indefinitely.')
      }
    },
    async ({ context: ctx, title, body, type, priority, freq, interval, byWeekday, startAt, untilAt }) => {
      const row = createRecurrence({
        context: ctx,
        title,
        body,
        type,
        priority,
        rule: { freq, interval, byWeekday, startAt, untilAt: untilAt ?? null }
      })
      if (!row) return text('That repeat rule could not be understood. Check freq, startAt and untilAt.')

      const rule = ruleFromRow(row)
      recordMcpActivity(
        'create_recurrence',
        ctx,
        `Set "${shorten(title)}" to repeat (${rule ? describeRule(rule) : freq})`,
        [{ kind: 'delete_recurrence', id: row.id }]
      )
      notifyRenderer()
      return json({ created: { id: row.id, nextDue: row.next_due, repeats: rule ? describeRule(rule) : freq } })
    }
  )

  mcp.registerTool(
    'delete_recurrence',
    {
      description: 'Stop a repeating rule. Items it already created are left alone.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => {
      const existing = getRecurrences().find(r => r.id === id)
      if (!existing) return text(`No recurrence with id "${id}".`)
      deleteRecurrence(id)
      recordMcpActivity('delete_recurrence', existing.context, `Stopped "${shorten(existing.title)}" repeating`, null)
      notifyRenderer()
      return text(`Stopped "${existing.title}" repeating.`)
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
      // Read before writing: this is the only moment the previous body exists.
      let previous: string | null = null
      try {
        previous = await readNote(oldTitle ?? title)
      } catch {
        previous = null   // no such note yet, so undo means deleting this one
      }

      await writeNote(title, content, oldTitle)

      const undo: McpUndoAction[] = []
      if (previous === null) {
        undo.push({ kind: 'delete_note', title })
      } else {
        if (oldTitle && oldTitle !== title) undo.push({ kind: 'delete_note', title })
        undo.push({ kind: 'write_note', title: oldTitle ?? title, content: previous })
      }
      recordMcpActivity(
        'write_note',
        null,
        previous === null ? `Created note "${shorten(title)}"` : `Rewrote note "${shorten(title)}"`,
        undo
      )
      notifyRenderer()
      return text(`Saved note "${title}".`)
    }
  )

  // Reference material
  // Cheatsheets are the user's own imported documentation. Exposing them lets an
  // agent ground an answer in what this person actually keeps to hand rather
  // than in whatever it happens to recall.

  mcp.registerTool(
    'list_cheatsheets',
    { description: 'List imported cheatsheet documents (PDF and text reference material).' },
    async () => json({ cheatsheets: await listCheatsheets() })
  )

  mcp.registerTool(
    'search_cheatsheets',
    {
      description: 'Search across all cheatsheets. Returns matching passages with their source document.',
      inputSchema: { query: z.string().min(2).describe('At least two characters.') }
    },
    async ({ query }) => json({ results: await searchCheatsheets(query) })
  )

  mcp.registerTool(
    'read_cheatsheet',
    {
      description: 'Read a cheatsheet as plain text. Use list_cheatsheets for valid names.',
      inputSchema: {
        name: z.string(),
        maxChars: z.number().int().positive().max(100000).optional()
          .describe('Truncate long documents. Defaults to 20000.')
      }
    },
    async ({ name, maxChars }) => {
      const body = await getCheatsheetText(name)
      if (!body) {
        // getCheatsheetText returns '' for a missing file as readily as for an
        // empty one. Left as-is, an agent cannot tell "this document has no
        // text" from "you invented that filename", and would keep retrying.
        const available = (await listCheatsheets()).map(c => c.name)
        return text(
          available.includes(name)
            ? `Cheatsheet "${name}" contains no extractable text.`
            : `No cheatsheet named "${name}". Available: ${available.join(', ') || '(none imported)'}`
        )
      }
      const cap = maxChars ?? 20000
      // Truncated by default: a full PDF can be hundreds of thousands of
      // characters, which would swamp a client's context in one call.
      return text(body.length > cap ? `${body.slice(0, cap)}\n\n…[truncated at ${cap} characters]` : body)
    }
  )

  // Assistant memory

  mcp.registerTool(
    'search_memories',
    {
      description:
        "Search what Checkpoint's built-in assistant has remembered about this user and their work.",
      inputSchema: {
        query: z.string(),
        context: z.string().optional().describe('Workspace slug. Defaults to "default".'),
        limit: z.number().int().positive().max(50).optional()
      }
    },
    async ({ query, context: ctx, limit }) =>
      withMemoryStore(() => json({ memories: searchMemories(query, ctx ?? 'default', limit ?? 8) }))
  )

  mcp.registerTool(
    'list_memories',
    {
      description: "List everything the built-in assistant has remembered for a workspace.",
      inputSchema: { context: z.string().optional() }
    },
    async ({ context: ctx }) => withMemoryStore(() => json({ memories: getMemories(ctx ?? 'default') }))
  )

  // Repository state
  // A workspace can be bound to a git repo, which is what makes "what have I
  // actually changed since I filed this card" answerable.

  mcp.registerTool(
    'get_git_status',
    {
      description: 'Branch and working-tree status for a git repository path.',
      inputSchema: { repoPath: z.string().describe('Absolute path to the repository.') }
    },
    async ({ repoPath }) => {
      if (!(await checkRepo(repoPath))) return text(`"${repoPath}" is not a git repository.`)
      return json(await getGitStatus(repoPath))
    }
  )

  mcp.registerTool(
    'get_git_log',
    {
      description: 'Recent commits for a git repository path.',
      inputSchema: { repoPath: z.string() }
    },
    async ({ repoPath }) => {
      if (!(await checkRepo(repoPath))) return text(`"${repoPath}" is not a git repository.`)
      return json({ commits: await getGitLog(repoPath) })
    }
  )

  // Time and activity

  mcp.registerTool(
    'get_analytics',
    {
      description:
        'Activity analytics: completions over time, tag distribution, active vs passive time, contribution heatmap.',
      inputSchema: {
        context: z.string().optional().describe('Workspace slug, or omit for all workspaces.')
      }
    },
    async ({ context: ctx }) => json(getAnalyticsData(ctx ?? null))
  )

  mcp.registerTool(
    'get_focus_sessions',
    {
      description: 'Recorded focus-timer sessions for a workspace.',
      inputSchema: { context }
    },
    async ({ context: ctx }) => json({ sessions: getFocusSessions(ctx) })
  )

  mcp.registerTool(
    'get_clipboard_history',
    {
      description: 'Recent clipboard captures and saved snippets.',
      inputSchema: {
        limit: z.number().int().positive().max(200).optional(),
        pinnedOnly: z.boolean().optional().describe('Only starred snippets.')
      }
    },
    async ({ limit, pinnedOnly }) => {
      const all = getClipboardHistory()
      // Stored as SQLite's 0/1 rather than a boolean.
      const filtered = pinnedOnly ? all.filter(c => c.is_pinned === 1) : all
      return json({ items: filtered.slice(0, limit ?? 50) })
    }
  )

  // Organisation

  mcp.registerTool(
    'create_tag',
    {
      description: 'Create a tag that can then be applied to items.',
      inputSchema: {
        name: z.string().min(1),
        color: z.string().optional().describe('Hex colour like #3b82f6. A default is chosen if omitted.')
      }
    },
    async ({ name, color }) => {
      // The DB validates the hex shape, so a bad colour would reject the whole
      // call; falling back keeps a tag from being lost over a formatting slip.
      const hex = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#535e85'
      const tag = createTag({ name, color: hex })
      recordMcpActivity('create_tag', null, `Created tag "${shorten(name, 30)}"`, [
        { kind: 'delete_tag', id: tag.id }
      ])
      notifyRenderer()
      return json({ created: tag })
    }
  )

  mcp.registerTool(
    'get_relations',
    {
      description: 'Relationships (blocks / relates_to / duplicates) for one item.',
      inputSchema: { itemId: z.string() }
    },
    async ({ itemId }) => json({ relations: getRelations(itemId) })
  )

  mcp.registerTool(
    'link_items',
    {
      description: 'Create a relationship between two items.',
      inputSchema: {
        fromId: z.string(),
        toId: z.string(),
        type: z.enum(['blocks', 'relates_to', 'duplicates'])
      }
    },
    async ({ fromId, toId, type }) => {
      if (!getItemById(fromId)) return text(`No item with id "${fromId}".`)
      if (!getItemById(toId)) return text(`No item with id "${toId}".`)
      const relation = createRelation(fromId, toId, type)
      recordMcpActivity('link_items', null, `Linked two items (${type})`, [
        { kind: 'delete_relation', id: relation.id }
      ])
      notifyRenderer()
      return json({ created: relation })
    }
  )

  mcp.registerTool(
    'archive_item',
    {
      description:
        'Archive an item, removing it from the board while keeping it recoverable. ' +
        'This is the safe alternative to deletion, nothing is destroyed.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => {
      if (!getItemById(id)) return text(`No item with id "${id}".`)
      // Archiving rather than deleting is deliberate: an agent acting on a
      // misread instruction should not be able to destroy work irreversibly,
      // and the app already treats 'archived' as its recoverable state.
      const before = getItemById(id)
      updateItem(getDb(), id, { status: 'archived' })
      recordMcpActivity(
        'archive_item',
        before?.context ?? null,
        `Archived "${shorten(before?.title ?? id)}"`,
        before ? [{ kind: 'restore_item', id, fields: { status: before.status } }] : null
      )
      notifyRenderer()
      return text(`Archived "${id}". It can be restored from the archive bin.`)
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
