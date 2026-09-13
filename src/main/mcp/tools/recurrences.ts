import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { deleteRecurrence, getRecurrences } from '../../db'
import { recordMcpActivity } from '../../mcpActivity'
import { createRecurrence, ruleFromRow } from '../../recurrenceService'
import { describeRule } from '../../../shared/recurrence'
import { shorten } from '../../../shared/mcpActivity'
import { context, json, notifyRenderer, text, z } from '../toolKit'

/** work that repeats */
export function registerRecurrenceTools(mcp: McpServer): void {
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
}
