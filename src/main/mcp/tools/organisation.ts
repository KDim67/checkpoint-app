import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createRelation, createTag, getAllTags, getItemById, getRelations } from '../../db'
import { recordMcpActivity } from '../../mcpActivity'
import { shorten } from '../../../shared/mcpActivity'
import { json, notifyRenderer, text, z } from '../toolKit'

/** tags and item relations */
export function registerOrganisationTools(mcp: McpServer): void {
  mcp.registerTool(
    'list_tags',
    { description: 'List every tag defined in Checkpoint.' },
    async () => json({ tags: getAllTags() })
  )

  mcp.registerTool(
    'create_tag',
    {
      description: 'Create a tag that can then be applied to items.',
      inputSchema: {
        name: z.string().min(1),
        color: z.string().optional().describe('Hex colour like #3b82f6. A default is chosen if omitted.')
      }
    },
    async ({ name, color }) => {
      // the DB rejects bad hex, fall back so a formatting slip doesn't lose the tag
      const hex = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#535e85'
      const tag = createTag({ name, color: hex })
      recordMcpActivity('create_tag', null, `Created tag "${shorten(name, 30)}"`, [
        { kind: 'delete_tag', id: tag.id }
      ])
      notifyRenderer()
      return json({ created: tag })
    }
  )

  mcp.registerTool(
    'get_relations',
    {
      description: 'Relationships (blocks / relates_to / duplicates) for one item.',
      inputSchema: { itemId: z.string() }
    },
    async ({ itemId }) => json({ relations: getRelations(itemId) })
  )

  mcp.registerTool(
    'link_items',
    {
      description: 'Create a relationship between two items.',
      inputSchema: {
        fromId: z.string(),
        toId: z.string(),
        type: z.enum(['blocks', 'relates_to', 'duplicates'])
      }
    },
    async ({ fromId, toId, type }) => {
      if (!getItemById(fromId)) return text(`No item with id "${fromId}".`)
      if (!getItemById(toId)) return text(`No item with id "${toId}".`)
      const relation = createRelation(fromId, toId, type)
      recordMcpActivity('link_items', null, `Linked two items (${type})`, [
        { kind: 'delete_relation', id: relation.id }
      ])
      notifyRenderer()
      return json({ created: relation })
    }
  )
}
