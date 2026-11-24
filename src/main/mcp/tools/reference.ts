import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getCheatsheetText, listCheatsheets, searchCheatsheets } from '../../cheatsheetService'
import { getMemories, searchMemories } from '../../memoryService'
import { error, json, READ_ONLY_ANNOTATIONS, text, validateWorkspace, z } from '../toolKit'

function withMemoryStore(fn: () => { content: { type: 'text'; text: string }[]; isError?: boolean }): {
  content: { type: 'text'; text: string }[]
  isError?: boolean
} {
  try {
    return fn()
  } catch (err) {
    console.error('[mcp] Memory store unavailable:', err)
    return error('The assistant memory store is not available yet. Try again once Checkpoint has finished starting.')
  }
}

/** imported cheatsheets and assistant memory */
export function registerReferenceTools(mcp: McpServer): void {
  mcp.registerTool(
    'cheatsheets',
    {
      title: 'Cheatsheets',
      description: 'List imported cheatsheets, search across them with query, or read one document by name.',
      inputSchema: {
        action: z.enum(['list', 'search', 'read']).optional().describe('Defaults to list (or read if name is passed, search if query is passed).'),
        query: z.string().min(2).optional().describe('Search text (at least 2 chars).'),
        name: z.string().optional().describe('Cheatsheet document name to read.'),
        maxChars: z.number().int().positive().max(100000).optional().describe('Truncate read output. Defaults to 20000.')
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ action, query, name, maxChars }) => {
      const mode = action ?? (name ? 'read' : query ? 'search' : 'list')

      if (mode === 'search') {
        if (!query || query.trim().length < 2) return error('query (at least 2 characters) is required when searching cheatsheets.')
        return json({ results: await searchCheatsheets(query) })
      }

      if (mode === 'read') {
        if (!name) return error('name is required when reading a cheatsheet.')
        const body = await getCheatsheetText(name)
        if (!body) {
          const available = (await listCheatsheets()).map(c => c.name)
          return error(
            available.includes(name)
              ? `Cheatsheet "${name}" contains no extractable text.`
              : `No cheatsheet named "${name}". Available: ${available.join(', ') || '(none imported)'}`
          )
        }
        const cap = maxChars ?? 20000
        return text(body.length > cap ? `${body.slice(0, cap)}\n\n…[truncated at ${cap} characters]` : body)
      }

      return json({ cheatsheets: await listCheatsheets() })
    }
  )

  mcp.registerTool(
    'memories',
    {
      title: 'Assistant Memories',
      description: "Read or search what Checkpoint's built-in assistant has remembered for a workspace.",
      inputSchema: {
        context: z.string().optional().describe('Workspace slug. Defaults to "default".'),
        query: z.string().optional().describe('Optional search query; omit to list all memories for the workspace.'),
        limit: z.number().int().positive().max(50).optional().describe('Max search results (default 8).')
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ context: ctx, query, limit }) => {
      const workspace = ctx ?? 'default'
      if (ctx) {
        const bad = validateWorkspace(ctx)
        if (bad) return error(bad)
      }
      return withMemoryStore(() =>
        query ? json({ memories: searchMemories(query, workspace, limit ?? 8) }) : json({ memories: getMemories(workspace) })
      )
    }
  )
}
