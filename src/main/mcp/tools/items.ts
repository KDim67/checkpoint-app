import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createItem, getDb, getItemById, queryTasks, searchItems, updateItem } from '../../db'
import { recordMcpActivity } from '../../mcpActivity'
import { shorten } from '../../../shared/mcpActivity'
import type { CreateItemPayload, Item } from '../../../shared/types'
import { context, json, notifyRenderer, PRIORITY_SCALE, readBoardConfig, summarizeItem, text, z } from '../toolKit'

/** logs, cards and tasks: find, create, change */
export function registerItemTools(mcp: McpServer): void {
  mcp.registerTool(
    'search_items',
    {
      description:
        'Full-text search across logs, cards and tasks. Use this when looking for wording, ' +
        'a phrase in a title or body. Use query_tasks instead to filter by status, priority or due date.',
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
      description:
        'Filter and sort a workspace\'s tasks by status, priority or due date. ' +
        'Use search_items instead to find something by its wording.',
      inputSchema: {
        context,
        query: z.string().optional().describe('Narrows to tasks whose title or body contains this.'),
        status: z
          .array(z.string())
          .optional()
          .describe('Column ids to include. get_board lists them.'),
        priority: z
          .array(z.number().int())
          .optional()
          .describe(`Priority levels to include. ${PRIORITY_SCALE}`),
        // enum: unknown fields used to fall back to created_at and only look sorted
        sortBy: z
          .enum(['status', 'priority', 'title', 'created_at', 'due_at', 'relations_count'])
          .optional()
          .describe('Defaults to created_at.'),
        sortDesc: z.boolean().optional().describe('Highest or latest first.'),
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
    'create_item',
    {
      description: 'Create a log entry, Kanban card or backlog task.',
      inputSchema: {
        context,
        type: z.enum(['log', 'card', 'task']),
        title: z.string(),
        body: z.string().optional(),
        status: z.string().optional().describe('Column id for cards. Defaults to the first column.'),
        priority: z.number().int().min(0).max(3).optional().describe(PRIORITY_SCALE),
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
        // a status no column owns hides the card, so fall back to the first real column
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
        status: z
          .string()
          .optional()
          .describe('Move to this column id. get_board lists them; this is how a card changes column.'),
        priority: z.number().int().min(0).max(3).optional().describe(PRIORITY_SCALE),
        due_at: z.number().nullable().optional().describe('Epoch milliseconds, or null to clear.')
      }
    },
    async ({ id, ...patch }) => {
      if (!getItemById(id)) return text(`No item with id "${id}".`)
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      if (Object.keys(clean).length === 0) return text('Nothing to update.')

      // captured before the write, only changed fields are worth restoring
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
    'archive_item',
    {
      description:
        'Archive an item, removing it from the board while keeping it recoverable. ' +
        'This is the safe alternative to deletion. Nothing is destroyed.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => {
      if (!getItemById(id)) return text(`No item with id "${id}".`)
      // archive not delete, a misread instruction shouldn't destroy work
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
}
