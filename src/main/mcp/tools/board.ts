import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getAllItems, getContextSlugs, getDb, updateItem } from '../../db'
import { applyConfigOps, normalizeConfigUpdate } from '../../../shared/boardOps'
import { recordMcpActivity } from '../../mcpActivity'
import { context, json, notifyRenderer, readBoardConfig, summarizeItem, text, writeBoardConfig, z } from '../toolKit'

/** Workspaces, and each one's board: its columns and the cards in them. */
export function registerBoardTools(mcp: McpServer): void {
  mcp.registerTool(
    'list_workspaces',
    { description: 'List every workspace in Checkpoint.' },
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
      const cards = getAllItems(ctx, 'card')
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
    'configure_board',
    {
      description:
        'Change a board\'s configuration: add, rename, recolour, reorder, WIP-limit, collapse or delete columns; ' +
        'set the background, priority swimlanes, or which fields appear on cards. Does not change card contents.',
      inputSchema: {
        context,
        // Spelled out rather than left as a free-form record. The shared
        // normalizer below is deliberately tolerant of aliases and loose types
        // because a small local model goes through it too, but that tolerance
        // is invisible to an MCP client, which only ever sees this schema and
        // was previously told nothing beyond "an array of objects".
        // .passthrough() keeps the aliases working for anything not named here.
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
                target: z
                  .string()
                  .optional()
                  .describe('Column name or id. Required by update_column and delete_column.'),
                name: z
                  .string()
                  .optional()
                  .describe('Column name: the identity for add_column, a rename for update_column.'),
                wipLimit: z
                  .number()
                  .int()
                  .positive()
                  .nullable()
                  .optional()
                  .describe('Work-in-progress limit, or null for no limit.'),
                color: z.string().optional().describe('Column colour as hex, e.g. "#1e45fc".'),
                colorMode: z
                  .enum(['header', 'full'])
                  .optional()
                  .describe('Tint only the header, or the whole column.'),
                collapsed: z
                  .boolean()
                  .optional()
                  .describe('Collapse to a narrow strip showing the name and count.'),
                sort: z
                  .enum(['manual', 'priority', 'due'])
                  .optional()
                  .describe('Ordering within the column. "manual" preserves drag order.'),
                description: z
                  .string()
                  .optional()
                  .describe("The column's definition of done, surfaced on hover."),
                position: z
                  .number()
                  .int()
                  .nonnegative()
                  .optional()
                  .describe('Insertion index for add_column. Appends when omitted.'),
                order: z
                  .array(z.string())
                  .optional()
                  .describe('Column ids or names in the desired order. Required by reorder_columns.'),
                background: z
                  .string()
                  .optional()
                  .describe('Preset id, hex colour, CSS gradient or image url. Required by set_background.'),
                swimlanes: z
                  .boolean()
                  .optional()
                  .describe('Group the board into priority swimlanes. Required by set_swimlanes.'),
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
      }
    },
    async ({ context: ctx, operations }) => {
      // Reuses the assistant's normalizer, so an MCP client gets the same
      // tolerance for aliases and loose types that a local model gets.
      const normalized = normalizeConfigUpdate({ operations })
      if (!normalized) return text('No valid operations found. Check the "op" values.')

      // An operation the normalizer cannot use is dropped before applyConfigOps
      // ever sees it, so it appeared in neither "applied" nor "skipped". A
      // client asking for three changes and getting two was told nothing.
      const unusable = operations.length - normalized.operations.length

      const config = readBoardConfig(ctx)
      const applied = applyConfigOps(config, normalized.operations)

      // Deleting a column would strand its cards under a status no column
      // claims; they follow to the first surviving column, matching the board.
      let movedCards = 0
      for (const move of applied.cardMoves) {
        const affected = getAllItems(ctx, 'card')
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
        // Cards moved off a deleted column are not restored by the inverse. The
        // column comes back, but which cards sat in it is not recoverable from
        // the config alone, so undo is only offered when nothing moved.
        applied.inverse.length > 0 && movedCards === 0
          ? [{ kind: 'board_ops', context: ctx, operations: applied.inverse }]
          : null
      )
      notifyRenderer()
      return json({
        applied: applied.summary,
        skipped: unusable > 0
          ? [
              ...applied.skipped,
              `${unusable} operation${unusable === 1 ? '' : 's'} could not be read. Check the fields that op requires.`
            ]
          : applied.skipped,
        movedCards,
        columns: applied.next.columns.map(c => ({ id: c.id, name: c.name, wipLimit: c.wipLimit }))
      })
    }
  )
}
