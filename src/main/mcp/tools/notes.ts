import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listNotes, readNote, searchNotes, writeNote } from '../../notesFsService'
import { recordMcpActivity } from '../../mcpActivity'
import { shorten, type McpUndoAction } from '../../../shared/mcpActivity'
import { error, IDEMPOTENT_WRITE_ANNOTATIONS, json, notifyRenderer, READ_ONLY_ANNOTATIONS, text, z } from '../toolKit'

/** markdown notes */
export function registerNoteTools(mcp: McpServer): void {
  mcp.registerTool(
    'notes',
    {
      title: 'Notes',
      description: 'List all markdown notes (default), read one note by exact title, or search across note contents with query.',
      inputSchema: {
        title: z.string().optional().describe('Exact note title to read.'),
        query: z.string().optional().describe('Text to search across note titles and bodies.')
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ title, query }) => {
      if (title !== undefined) {
        const available = await listNotes()
        const exists = available.some(n => n.title === title)
        if (!exists) {
          return error(
            `No note titled "${title}". Available: ${available.slice(0, 20).map(n => n.title).join(', ') || '(none)'}`
          )
        }
        return text(await readNote(title))
      }
      if (query !== undefined) {
        return json({ results: await searchNotes(query) })
      }
      return json({ notes: await listNotes() })
    }
  )

  mcp.registerTool(
    'write_note',
    {
      title: 'Write Note',
      description:
        'Create a markdown note, or replace the whole content of an existing one. ' +
        'Writing to an existing title overwrites it; read it first with notes if current content matters.',
      inputSchema: {
        title: z.string().min(1),
        content: z.string(),
        oldTitle: z.string().optional().describe('Set when renaming an existing note.')
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS
    },
    async ({ title, content, oldTitle }) => {
      const targetTitle = oldTitle ?? title
      const existing = (await listNotes()).some(n => n.title === targetTitle)
      const previous = existing ? await readNote(targetTitle) : null

      try {
        await writeNote(title, content, oldTitle)
      } catch (err) {
        return error(err instanceof Error ? err.message : `Could not write note "${title}".`)
      }

      const undo: McpUndoAction[] = []
      if (previous === null) {
        undo.push({ kind: 'delete_note', title })
      } else {
        if (oldTitle && oldTitle !== title) undo.push({ kind: 'delete_note', title })
        undo.push({ kind: 'write_note', title: targetTitle, content: previous })
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
