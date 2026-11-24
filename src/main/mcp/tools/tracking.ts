import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getClipboardHistory, getFocusSessions } from '../../db'
import { checkRepo, getGitLog, getGitStatus } from '../../gitService'
import { getAnalyticsData } from '../../analyticsService'
import { error, json, READ_ONLY_ANNOTATIONS, validateWorkspace, z } from '../toolKit'

/** repo state, activity analytics, focus time, clipboard */
export function registerTrackingTools(mcp: McpServer): void {
  mcp.registerTool(
    'get_git_info',
    {
      title: 'Get Git Info',
      description: 'Read working-tree status, recent commits, or both for a local git repository path.',
      inputSchema: {
        repoPath: z.string().describe('Absolute path to the repository.'),
        include: z.enum(['status', 'log', 'both']).optional().describe('What to return. Defaults to both.')
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ repoPath, include }) => {
      if (!(await checkRepo(repoPath))) return error(`"${repoPath}" is not a git repository.`)
      const mode = include ?? 'both'
      const [status, commits] = await Promise.all([
        mode === 'status' || mode === 'both' ? getGitStatus(repoPath) : Promise.resolve(undefined),
        mode === 'log' || mode === 'both' ? getGitLog(repoPath) : Promise.resolve(undefined)
      ])
      return json({
        ...(status !== undefined ? { status } : {}),
        ...(commits !== undefined ? { commits } : {})
      })
    }
  )

  mcp.registerTool(
    'get_tracking_data',
    {
      title: 'Get Tracking Data',
      description: "Read productivity analytics ('analytics'), focus-timer sessions ('focus'), or clipboard captures ('clipboard').",
      inputSchema: {
        kind: z.enum(['analytics', 'focus', 'clipboard']),
        context: z.string().optional().describe('Workspace slug. Required for focus; optional filter for analytics.'),
        limit: z.number().int().positive().max(200).optional().describe('Max clipboard entries (default 50).'),
        pinnedOnly: z.boolean().optional().describe('Clipboard only: return only starred snippets.')
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ kind, context: ctx, limit, pinnedOnly }) => {
      if (ctx) {
        const bad = validateWorkspace(ctx)
        if (bad) return error(bad)
      }

      if (kind === 'analytics') {
        return json(getAnalyticsData(ctx ?? null))
      }

      if (kind === 'focus') {
        if (!ctx) return error('context (workspace slug) is required when reading focus sessions.')
        return json({ sessions: getFocusSessions(ctx) })
      }

      const all = getClipboardHistory()
      const filtered = pinnedOnly ? all.filter(c => c.is_pinned === 1) : all
      return json({ items: filtered.slice(0, limit ?? 50) })
    }
  )
}
