import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listNotes, readNote, searchNotes, writeNote } from '../../notesFsService'
import { recordMcpActivity } from '../../mcpActivity'
import { shorten, type McpUndoAction } from '../../../shared/mcpActivity'
import { json, notifyRenderer, text, z } from '../toolKit'

/** markdown notes */
export function registerNoteTools(mcp: McpServer): void {
  mcp.registerTool(
    'list_notes',
    { description: 'List all markdown notes with their metadata.' },
    async () => json({ notes: await listNotes() })
  )

  mcp.registerTool(
    'read_note',
    {
      description: 'Read one markdown note by title.',
      inputSchema: { title: z.string() }
    },
    async ({ title }) => text(await readNote(title))
  )

  mcp.registerTool(
    'search_notes',
    {
      description: 'Search note contents.',
      inputSchema: { query: z.string() }
    },
    async ({ query }) => json({ results: await searchNotes(query) })
  )

  mcp.registerTool(
    'write_note',
    {
      description:
        'Create a markdown note, or replace the whole content of an existing one. ' +
        'Writing to a title that already exists overwrites it. Read_note first if the current content matters.',
      inputSchema: {
        title: z.string(),
        content: z.string(),
        oldTitle: z.string().optional().describe('Set when renaming an existing note.')
      }
    },
    async ({ title, content, oldTitle }) => {
      // read first, the only moment the previous body exists
      let previous: string | null = null
      try {
        previous = await readNote(oldTitle ?? title)
      } catch {
        previous = null   // no such note yet, so undo means deleting this one
      }

      await writeNote(title, content, oldTitle)

      const undo: McpUndoAction[] = []
      if (previous === null) {
        undo.push({ kind: 'delete_note', title })
      } else {
        if (oldTitle && oldTitle !== title) undo.push({ kind: 'delete_note', title })
        undo.push({ kind: 'write_note', title: oldTitle ?? title, content: previous })
      }
      recordMcpActivity(
        'write_note',
        null,
        previous === null ? `Created note "${shorten(title)}"` : `Rewrote note "${shorten(title)}"`,
        undo
      )
      notifyRenderer()
      return text(`Saved note "${title}".`)
    }
  )
}
