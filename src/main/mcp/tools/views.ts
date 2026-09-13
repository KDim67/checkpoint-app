import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getDb, getSetting, queryTasks } from '../../db'
import { BUILT_IN_VIEWS, describeView, normalizeSavedViews, toQueryParams } from '../../../shared/savedViews'
import { context, json, summarizeItem, text, z } from '../toolKit'

/** saved task views */
export function registerViewTools(mcp: McpServer): void {
  // named filters give agents the user's vocabulary instead of restated queries

  mcp.registerTool(
    'list_views',
    { description: 'List saved task views. Named filters like "Overdue" or "High priority".' },
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
}
