import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getClipboardHistory, getFocusSessions } from '../../db'
import { checkRepo, getGitLog, getGitStatus } from '../../gitService'
import { getAnalyticsData } from '../../analyticsService'
import { context, json, text, z } from '../toolKit'

/** What has been happening: repository state, activity, focus time and the clipboard. */
export function registerTrackingTools(mcp: McpServer): void {
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
}
