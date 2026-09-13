import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'crypto'
import { getItemById, getSubtasks, insertSubtask, updateSubtask } from '../../db'
import { recordMcpActivity } from '../../mcpActivity'
import { computeProgress, nextPosition, normalizeSubtasks } from '../../../shared/subtasks'
import { shorten } from '../../../shared/mcpActivity'
import { json, notifyRenderer, text, z } from '../toolKit'

/** subtasks of a card or task */
export function registerSubtaskTools(mcp: McpServer): void {
  // rows, not body checkboxes, so they can be listed, counted and ticked

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
}
