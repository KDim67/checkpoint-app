import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getCheatsheetText, listCheatsheets, searchCheatsheets } from '../../cheatsheetService'
import { getMemories, searchMemories } from '../../memoryService'
import { json, text, z } from '../toolKit'

/**
 * Guards the memory tools.
 *
 * memoryService prepares its statements in initMemoryIpc() at app boot and
 * getMemories() dereferences them without checking, so calling it before that
 * has run throws on an undefined statement. That should never happen in the
 * packaged app (boot order puts memory init first), but a failed init would
 * otherwise surface to an agent as an opaque crash rather than a usable answer.
 */
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

/** What the user keeps to hand: imported cheatsheets, and what the assistant remembers. */
export function registerReferenceTools(mcp: McpServer): void {
  // Reference material
  // Cheatsheets are the user's own imported documentation. Exposing them lets an
  // agent ground an answer in what this person actually keeps to hand rather
  // than in whatever it happens to recall.

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
        // getCheatsheetText returns '' for a missing file as readily as for an
        // empty one. Left as-is, an agent cannot tell "this document has no
        // text" from "you invented that filename", and would keep retrying.
        const available = (await listCheatsheets()).map(c => c.name)
        return text(
          available.includes(name)
            ? `Cheatsheet "${name}" contains no extractable text.`
            : `No cheatsheet named "${name}". Available: ${available.join(', ') || '(none imported)'}`
        )
      }
      const cap = maxChars ?? 20000
      // Truncated by default: a full PDF can be hundreds of thousands of
      // characters, which would swamp a client's context in one call.
      return text(body.length > cap ? `${body.slice(0, cap)}\n\n…[truncated at ${cap} characters]` : body)
    }
  )

  // Assistant memory

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
