import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getCheatsheetText, listCheatsheets, searchCheatsheets } from '../../cheatsheetService'
import { getMemories, searchMemories } from '../../memoryService'
import { json, text, z } from '../toolKit'

/** getMemories derefs statements from initMemoryIpc; a failed init would reach the agent as an opaque crash */
function withMemoryStore(fn: () => { content: { type: 'text'; text: string }[] }): {
  content: { type: 'text'; text: string }[]
} {
  try {
    return fn()
  } catch (err) {
    console.error('[mcp] Memory store unavailable:', err)
    return text('The assistant memory store is not available yet. Try again once Checkpoint has finished starting.')
  }
}

/** imported cheatsheets and assistant memory */
export function registerReferenceTools(mcp: McpServer): void {
  // lets an agent ground answers in the user's own docs

  mcp.registerTool(
    'list_cheatsheets',
    { description: 'List imported cheatsheet documents (PDF and text reference material).' },
    async () => json({ cheatsheets: await listCheatsheets() })
  )

  mcp.registerTool(
    'search_cheatsheets',
    {
      description: 'Search across all cheatsheets. Returns matching passages with their source document.',
      inputSchema: { query: z.string().min(2).describe('At least two characters.') }
    },
    async ({ query }) => json({ results: await searchCheatsheets(query) })
  )

  mcp.registerTool(
    'read_cheatsheet',
    {
      description: 'Read a cheatsheet as plain text. Use list_cheatsheets for valid names.',
      inputSchema: {
        name: z.string(),
        maxChars: z.number().int().positive().max(100000).optional()
          .describe('Truncate long documents. Defaults to 20000.')
      }
    },
    async ({ name, maxChars }) => {
      const body = await getCheatsheetText(name)
      if (!body) {
        // '' means missing or empty, so name the real files or the agent keeps retrying
        const available = (await listCheatsheets()).map(c => c.name)
        return text(
          available.includes(name)
            ? `Cheatsheet "${name}" contains no extractable text.`
            : `No cheatsheet named "${name}". Available: ${available.join(', ') || '(none imported)'}`
        )
      }
      const cap = maxChars ?? 20000
      // truncated by default, a full PDF would swamp the client's context
      return text(body.length > cap ? `${body.slice(0, cap)}\n\n…[truncated at ${cap} characters]` : body)
    }
  )

  mcp.registerTool(
    'search_memories',
    {
      description:
        "Search what Checkpoint's built-in assistant has remembered about this user and their work.",
      inputSchema: {
        query: z.string(),
        context: z.string().optional().describe('Workspace slug. Defaults to "default".'),
        limit: z.number().int().positive().max(50).optional()
      }
    },
    async ({ query, context: ctx, limit }) =>
      withMemoryStore(() => json({ memories: searchMemories(query, ctx ?? 'default', limit ?? 8) }))
  )

  mcp.registerTool(
    'list_memories',
    {
      description: "List everything the built-in assistant has remembered for a workspace.",
      inputSchema: { context: z.string().optional() }
    },
    async ({ context: ctx }) => withMemoryStore(() => json({ memories: getMemories(ctx ?? 'default') }))
  )
}
