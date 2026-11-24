import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { deleteRecurrence, getRecurrences } from '../../db'
import { recordMcpActivity } from '../../mcpActivity'
import { createRecurrence, ruleFromRow } from '../../recurrenceService'
import { describeRule } from '../../../shared/recurrence'
import { shorten } from '../../../shared/mcpActivity'
import { error, json, notifyRenderer, text, validateWorkspace, WRITE_ANNOTATIONS, z } from '../toolKit'

/** work that repeats */
export function registerRecurrenceTools(mcp: McpServer): void {
  mcp.registerTool(
    'manage_recurrences',
    {
      title: 'Manage Recurrences',
      description:
        "List, create, or stop repeating work rules. Creating sets one item at a time: the next occurrence appears " +
        'only once the previous one is done.',
      inputSchema: {
        action: z.enum(['list', 'create', 'delete']),
        context: z.string().optional().describe('Workspace slug. Required for list and create.'),
        id: z.string().optional().describe('Recurrence id (required for delete).'),
        title: z.string().min(1).optional().describe('Item title (required for create).'),
        body: z.string().optional(),
        type: z.enum(['card', 'task']).optional().describe('Defaults to task.'),
        priority: z.number().int().min(0).max(3).optional(),
        freq: z.enum(['daily', 'weekly', 'monthly']).optional().describe('Repeat frequency (required for create).'),
        interval: z.number().int().min(1).optional().describe('Every N periods. Defaults to 1.'),
        byWeekday: z.array(z.number().int().min(0).max(6)).optional().describe('Weekly rules only. 0 is Sunday.'),
        startAt: z.number().optional().describe('Epoch milliseconds of first occurrence (required for create).'),
        untilAt: z.number().nullable().optional().describe('Epoch milliseconds. Omit to repeat indefinitely.')
      },
      annotations: WRITE_ANNOTATIONS
    },
    async ({ action, context: ctx, id, title, body, type, priority, freq, interval, byWeekday, startAt, untilAt }) => {
      if (action === 'list') {
        if (!ctx) return error('context (workspace slug) is required when listing recurrences.')
        const bad = validateWorkspace(ctx)
        if (bad) return error(bad)
        return json({
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
      }

      if (action === 'delete') {
        if (!id) return error('id is required when deleting a recurrence.')
        const existing = getRecurrences().find(r => r.id === id)
        if (!existing) return error(`No recurrence with id "${id}".`)
        deleteRecurrence(id)
        recordMcpActivity('manage_recurrences', existing.context, `Stopped "${shorten(existing.title)}" repeating`, null)
        notifyRenderer()
        return text(`Stopped "${existing.title}" repeating.`)
      }

      // action === 'create'
      if (!ctx || !title || !freq || startAt === undefined) {
        return error('context, title, freq, and startAt are required when creating a recurrence.')
      }
      const row = createRecurrence({
        context: ctx,
        title,
        body,
        type,
        priority,
        rule: { freq, interval, byWeekday, startAt, untilAt: untilAt ?? null }
      })
      if (!row) return error('That repeat rule could not be understood. Check freq, startAt and untilAt.')

      const rule = ruleFromRow(row)
      recordMcpActivity(
        'manage_recurrences',
        ctx,
        `Set "${shorten(title)}" to repeat (${rule ? describeRule(rule) : freq})`,
        [{ kind: 'delete_recurrence', id: row.id }]
      )
      notifyRenderer()
      return json({ created: { id: row.id, nextDue: row.next_due, repeats: rule ? describeRule(rule) : freq } })
    }
  )
}
