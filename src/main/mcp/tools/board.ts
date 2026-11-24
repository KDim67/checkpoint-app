import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getAllItems, getAllTags, getContextSlugs, getDb, getSetting, updateItem } from '../../db'
import { applyConfigOps, normalizeConfigUpdate } from '../../../shared/boardOps'
import { BUILT_IN_VIEWS, describeView, normalizeSavedViews } from '../../../shared/savedViews'
import { recordMcpActivity } from '../../mcpActivity'
import {
  context,
  error,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  json,
  notifyRenderer,
  READ_ONLY_ANNOTATIONS,
  readBoardConfig,
  summarizeItem,
  validateWorkspace,
  writeBoardConfig,
  z
} from '../toolKit'

/** workspaces and their boards: columns, cards, tags and saved views */
export function registerBoardTools(mcp: McpServer): void {
  mcp.registerTool(
    'list_workspaces',
    {
      title: 'List Workspaces',
      description: 'List every workspace slug in Checkpoint.',
      annotations: READ_ONLY_ANNOTATIONS
    },
    async () => json({ workspaces: getContextSlugs() })
  )

  mcp.registerTool(
    'get_board',
    {
      title: 'Get Board',
      description: "Get a workspace's Kanban board (columns and cards), defined tags, and saved task views.",
      inputSchema: { context },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ context: ctx }) => {
      const bad = validateWorkspace(ctx)
      if (bad) return error(bad)

      const config = readBoardConfig(ctx)
      const cards = getAllItems(ctx, 'card')
      const storedViews = getSetting<unknown>('saved_views', null)
      const views = [...BUILT_IN_VIEWS, ...normalizeSavedViews(storedViews)]

      return json({
        context: ctx,
        background: config.background,
        swimlanes: config.swimlanes,
        cardDisplay: config.cardDisplay,
        tags: getAllTags(),
        views: views.map(v => ({ id: v.id, name: v.name, describes: describeView(v), builtIn: v.builtIn === true })),
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
    'configure_board',
    {
      title: 'Configure Board',
      description:
        "Change a board's configuration: add, rename, recolour, reorder, WIP-limit, collapse or delete columns; " +
        'set the background, priority swimlanes, or which fields appear on cards. Does not change card contents.',
      inputSchema: {
        context,
        operations: z
          .array(
            z
              .object({
                op: z
                  .enum([
                    'add_column',
                    'update_column',
                    'delete_column',
                    'reorder_columns',
                    'set_background',
                    'set_swimlanes',
                    'set_card_display'
                  ])
                  .describe('Which change to make.'),
                target: z.string().optional().describe('Column name or id. Required by update_column and delete_column.'),
                name: z.string().optional().describe('Column name: the identity for add_column, a rename for update_column.'),
                wipLimit: z.number().int().positive().nullable().optional().describe('Work-in-progress limit, or null for no limit.'),
                color: z.string().optional().describe('Column colour as hex, e.g. "#1e45fc".'),
                colorMode: z.enum(['header', 'full']).optional().describe('Tint only the header, or the whole column.'),
                collapsed: z.boolean().optional().describe('Collapse to a narrow strip showing the name and count.'),
                sort: z.enum(['manual', 'priority', 'due']).optional().describe('Ordering within the column. "manual" preserves drag order.'),
                description: z.string().optional().describe("The column's definition of done, surfaced on hover."),
                position: z.number().int().nonnegative().optional().describe('Insertion index for add_column. Appends when omitted.'),
                order: z.array(z.string()).optional().describe('Column ids or names in the desired order. Required by reorder_columns.'),
                background: z.string().optional().describe('Preset id, hex colour, CSS gradient or image url. Required by set_background.'),
                swimlanes: z.boolean().optional().describe('Group the board into priority swimlanes. Required by set_swimlanes.'),
                cardDisplay: z
                  .object({
                    priority: z.boolean().optional(),
                    tags: z.boolean().optional(),
                    due: z.boolean().optional(),
                    bodyPreview: z.boolean().optional()
                  })
                  .optional()
                  .describe('Which fields appear on cards. Required by set_card_display.')
              })
              .passthrough()
          )
          .min(1)
          .describe('The changes to apply, in order.')
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS
    },
    async ({ context: ctx, operations }) => {
      const normalized = normalizeConfigUpdate({ operations })
      if (!normalized) return error('No valid operations found. Check the "op" values.')

      const unusable = operations.length - normalized.operations.length
      const config = readBoardConfig(ctx)
      const applied = applyConfigOps(config, normalized.operations)

      let movedCards = 0
      for (const move of applied.cardMoves) {
        const affected = getAllItems(ctx, 'card').filter(i => i.status === move.fromColumn)
        for (const card of affected) {
          updateItem(getDb(), card.id, { status: move.toColumn })
          movedCards++
        }
      }

      writeBoardConfig(ctx, applied.next)
      recordMcpActivity(
        'configure_board',
        ctx,
        applied.summary.length > 0 ? `Board: ${applied.summary.join('; ')}` : 'Board configuration changed',
        applied.inverse.length > 0 && movedCards === 0
          ? [{ kind: 'board_ops', context: ctx, operations: applied.inverse }]
          : null
      )
      notifyRenderer()
      return json({
        applied: applied.summary,
        skipped:
          unusable > 0
            ? [...applied.skipped, `${unusable} operation${unusable === 1 ? '' : 's'} could not be read. Check the fields that op requires.`]
            : applied.skipped,
        movedCards,
        columns: applied.next.columns.map(c => ({ id: c.id, name: c.name, wipLimit: c.wipLimit }))
      })
    }
  )
}
