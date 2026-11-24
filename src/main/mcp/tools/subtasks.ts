import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'crypto'
import { getItemById, getSubtaskById, getSubtasks, insertSubtask, updateSubtask } from '../../db'
import { recordMcpActivity } from '../../mcpActivity'
import { computeProgress, nextPosition, normalizeSubtasks } from '../../../shared/subtasks'
import { shorten } from '../../../shared/mcpActivity'
import { error, json, notifyRenderer, text, WRITE_ANNOTATIONS, z } from '../toolKit'

/** subtasks of a card or task */
export function registerSubtaskTools(mcp: McpServer): void {
  mcp.registerTool(
    'manage_subtasks',
    {
      title: 'Manage Subtasks',
      description:
        "List, add, or toggle subtasks on a card or task. Use action='list' or 'add' with id (the parent item id), " +
        "or action='set_done' with id (the subtask id) and done.",
      inputSchema: {
        action: z.enum(['list', 'add', 'set_done']),
        id: z.string().describe('Parent item id for list/add, or subtask id for set_done.'),
        title: z.string().min(1).optional().describe('Subtask title (required for add).'),
        done: z.boolean().optional().describe('Completion state (required for set_done).')
      },
      annotations: WRITE_ANNOTATIONS
    },
    async ({ action, id, title, done }) => {
      if (action === 'list') {
        if (!getItemById(id)) return error(`No item with id "${id}".`)
        const subtasks = normalizeSubtasks(getSubtasks(id))
        const progress = computeProgress(subtasks)
        return json({
          progress: { done: progress.done, total: progress.total },
          subtasks: subtasks.map(s => ({ id: s.id, title: s.title, done: s.done }))
        })
      }

      if (action === 'add') {
        const parent = getItemById(id)
        if (!parent) return error(`No item with id "${id}".`)
        const cleanTitle = title?.trim()
        if (!cleanTitle) return error('title is required when adding a subtask.')

        const subtaskId = randomUUID()
        insertSubtask({
          id: subtaskId,
          item_id: id,
          title: cleanTitle,
          done: 0,
          position: nextPosition(normalizeSubtasks(getSubtasks(id))),
          created_at: Date.now()
        })
        recordMcpActivity(
          'manage_subtasks',
          parent.context,
          `Added subtask "${shorten(cleanTitle)}" to "${shorten(parent.title)}"`,
          [{ kind: 'delete_subtask', id: subtaskId }]
        )
        notifyRenderer()
        return json({ created: { id: subtaskId, title: cleanTitle } })
      }

      // action === 'set_done'
      if (done === undefined) return error('done (boolean) is required when action is set_done.')
      const existing = getSubtaskById(id)
      if (!existing) return error(`No subtask with id "${id}".`)
      const parent = getItemById(existing.item_id)

      updateSubtask(id, { done })
      recordMcpActivity(
        'manage_subtasks',
        parent?.context ?? null,
        `${done ? 'Completed' : 'Reopened'} subtask "${shorten(existing.title)}"`,
        [{ kind: 'set_subtask_done', id, done: !done }]
      )
      notifyRenderer()
      return text(`Subtask "${existing.title}" marked ${done ? 'done' : 'not done'}.`)
    }
  )
}
