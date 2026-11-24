import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createItem, getDb, getItemById, getSetting, getSubtasks, queryTasks, searchItems, updateItem } from '../../db'
import { recordMcpActivity } from '../../mcpActivity'
import { shorten } from '../../../shared/mcpActivity'
import { BUILT_IN_VIEWS, describeView, normalizeSavedViews, toQueryParams } from '../../../shared/savedViews'
import { normalizeSubtasks } from '../../../shared/subtasks'
import type { CreateItemPayload, Item } from '../../../shared/types'
import {
  context,
  error,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  json,
  notifyRenderer,
  PRIORITY_SCALE,
  READ_ONLY_ANNOTATIONS,
  readBoardConfig,
  summarizeItem,
  text,
  validateWorkspace,
  WRITE_ANNOTATIONS,
  z
} from '../toolKit'

/** logs, cards and tasks: query, search, create, update, archive */
export function registerItemTools(mcp: McpServer): void {
  mcp.registerTool(
    'query_items',
    {
      title: 'Query Items',
      description:
        'Find logs, cards and tasks. Supports full-text search (query), saved views by id or name (view — check get_board for available views), ' +
        'and filtering/sorting by status, priority or type. Omit context only for full-text search across all workspaces.',
      inputSchema: {
        context: z.string().optional().describe('Workspace slug. Required for saved views and structured task queries; optional for text search.'),
        query: z.string().optional().describe('Full-text search text across titles and bodies.'),
        view: z.string().optional().describe('Saved view id or exact name (e.g. "Overdue", "High priority"). Relative dates resolve now.'),
        type: z.enum(['log', 'card', 'task']).optional(),
        status: z.array(z.string()).optional().describe('Column or status ids to include. get_board lists them.'),
        priority: z.array(z.number().int()).optional().describe(`Priority levels to include. ${PRIORITY_SCALE}`),
        sortBy: z
          .enum(['status', 'priority', 'title', 'created_at', 'due_at', 'relations_count'])
          .optional()
          .describe('Defaults to created_at.'),
        sortDesc: z.boolean().optional().describe('Highest or latest first.'),
        limit: z.number().int().positive().max(200).optional().describe('Max results (default 50, max 200).'),
        includeSubtasks: z.boolean().optional().describe('Include each item\'s subtasks inline.')
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ context: ctx, query, view, type, status, priority, sortBy, sortDesc, limit, includeSubtasks }) => {
      if (ctx) {
        const bad = validateWorkspace(ctx)
        if (bad) return error(bad)
      }

      const attachSubtasks = (item: Item) => {
        const base = summarizeItem(item)
        if (!includeSubtasks) return base
        const subs = normalizeSubtasks(getSubtasks(item.id)).map(s => ({ id: s.id, title: s.title, done: s.done }))
        return { ...base, subtasks: subs }
      }

      if (view) {
        if (!ctx) return error('context is required when running a saved view. Use list_workspaces first.')
        const stored = getSetting<unknown>('saved_views', null)
        const views = [...BUILT_IN_VIEWS, ...normalizeSavedViews(stored)]
        const match =
          views.find(v => v.id === view) ??
          views.find(v => v.name.toLowerCase() === view.trim().toLowerCase())
        if (!match) {
          return error(`No view called "${view}". Available: ${views.map(v => v.name).join(', ')}.`)
        }
        const params = { ...toQueryParams(match, Date.now()), ...(query ? { query } : {}), page: 1, pageSize: limit ?? 50 }
        const result = queryTasks(getDb(), ctx, params)
        return json({
          view: { id: match.id, name: match.name, describes: describeView(match) },
          total: result.total,
          items: result.items.map(attachSubtasks)
        })
      }

      // pure full-text search when no board/task filters are passed
      if (query && !status && !priority && !sortBy && sortDesc === undefined) {
        const found = searchItems({ query, context: ctx, type, page: 0, pageSize: limit ?? 25 })
        return json({ total: found.total, items: found.items.map(attachSubtasks) })
      }

      if (!ctx) return error('context is required when filtering or sorting tasks. Pass query alone to search across all workspaces.')

      const result = queryTasks(getDb(), ctx, {
        query,
        status,
        priority,
        sortBy,
        sortDesc,
        page: 1,
        pageSize: limit ?? 50
      })
      const items = type ? result.items.filter(i => i.type === type) : result.items
      return json({ total: items.length, items: items.map(attachSubtasks) })
    }
  )

  mcp.registerTool(
    'create_item',
    {
      title: 'Create Item',
      description: 'Create a log entry, Kanban card or backlog task.',
      inputSchema: {
        context,
        type: z.enum(['log', 'card', 'task']),
        title: z.string().min(1),
        body: z.string().optional(),
        status: z.string().optional().describe('Column id for cards. Defaults to the first column.'),
        priority: z.number().int().min(0).max(3).optional().describe(PRIORITY_SCALE),
        due_at: z.number().nullable().optional().describe('Epoch milliseconds. Midnight UTC Date.UTC(year, month, day) for date-only.')
      },
      annotations: WRITE_ANNOTATIONS
    },
    async ({ context: ctx, type, title, body, status, priority, due_at }) => {
      if (!ctx.trim()) return error('Workspace context cannot be empty.')
      const config = readBoardConfig(ctx)
      const payload: CreateItemPayload = {
        type,
        context: ctx,
        title,
        body: body ?? '',
        // a status no column owns hides the card, so fall back to the first real column
        status:
          status && config.columns.some(c => c.id === status)
            ? status
            : type === 'card'
              ? config.columns[0].id
              : 'open',
        priority: (priority ?? 2) as Item['priority'],
        position: Date.now(),
        due_at: due_at ?? null,
        metadata: '{}'
      }
      const created = createItem(getDb(), payload)
      recordMcpActivity('create_item', ctx, `Created ${type} "${shorten(title)}"`, [{ kind: 'delete_item', id: created.id }])
      notifyRenderer()
      return json({ created: summarizeItem(created) })
    }
  )

  mcp.registerTool(
    'update_item',
    {
      title: 'Update Item',
      description: 'Update an existing log, card or task by id.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
        status: z.string().optional().describe('Move to this column id. get_board lists them; this is how a card changes column.'),
        priority: z.number().int().min(0).max(3).optional().describe(PRIORITY_SCALE),
        due_at: z.number().nullable().optional().describe('Epoch milliseconds, or null to clear.')
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS
    },
    async ({ id, ...patch }) => {
      const before = getItemById(id)
      if (!before) return error(`No item with id "${id}".`)
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      if (Object.keys(clean).length === 0) return error('Nothing to update. Supply at least one field to change.')

      const restored: Record<string, unknown> = {}
      for (const key of Object.keys(clean)) {
        restored[key] = (before as unknown as Record<string, unknown>)[key]
      }

      const updated = updateItem(getDb(), id, clean as Partial<Item>)
      recordMcpActivity(
        'update_item',
        before.context,
        `Updated "${shorten(before.title)}" (${Object.keys(clean).join(', ')})`,
        [{ kind: 'restore_item', id, fields: restored }]
      )
      notifyRenderer()
      return json({ updated: summarizeItem(updated) })
    }
  )

  mcp.registerTool(
    'archive_item',
    {
      title: 'Archive Item',
      description: 'Archive an item, removing it from the active board while keeping it recoverable.',
      inputSchema: { id: z.string() },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS
    },
    async ({ id }) => {
      const before = getItemById(id)
      if (!before) return error(`No item with id "${id}".`)
      updateItem(getDb(), id, { status: 'archived' })
      recordMcpActivity(
        'archive_item',
        before.context,
        `Archived "${shorten(before.title)}"`,
        [{ kind: 'restore_item', id, fields: { status: before.status } }]
      )
      notifyRenderer()
      return text(`Archived "${id}". It can be restored from the archive bin.`)
    }
  )
}
