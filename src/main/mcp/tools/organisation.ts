import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createRelation, createTag, getItemById, getRelations } from '../../db'
import { recordMcpActivity } from '../../mcpActivity'
import { shorten } from '../../../shared/mcpActivity'
import { error, json, notifyRenderer, WRITE_ANNOTATIONS, z } from '../toolKit'

/** tags and item relations */
export function registerOrganisationTools(mcp: McpServer): void {
  mcp.registerTool(
    'create_tag',
    {
      title: 'Create Tag',
      description: 'Create a tag that can be applied to items. Use get_board to list existing tags.',
      inputSchema: {
        name: z.string().min(1),
        color: z.string().optional().describe('Hex colour like #3b82f6. Defaults to slate if omitted.')
      },
      annotations: WRITE_ANNOTATIONS
    },
    async ({ name, color }) => {
      const hex = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#535e85'
      const tag = createTag({ name, color: hex })
      recordMcpActivity('create_tag', null, `Created tag "${shorten(name, 30)}"`, [{ kind: 'delete_tag', id: tag.id }])
      notifyRenderer()
      return json({ created: tag })
    }
  )

  mcp.registerTool(
    'manage_relations',
    {
      title: 'Manage Item Relations',
      description: "Read or create relationships (blocks, relates_to, duplicates) between items. Use action='get' with itemId, or action='link' with fromId, toId, and type.",
      inputSchema: {
        action: z.enum(['get', 'link']),
        itemId: z.string().optional().describe('Item id (required for action=get).'),
        fromId: z.string().optional().describe('Source item id (required for action=link).'),
        toId: z.string().optional().describe('Target item id (required for action=link).'),
        type: z.enum(['blocks', 'relates_to', 'duplicates']).optional().describe('Relation type (required for action=link).')
      },
      annotations: WRITE_ANNOTATIONS
    },
    async ({ action, itemId, fromId, toId, type }) => {
      if (action === 'get') {
        if (!itemId) return error('itemId is required when action is get.')
        if (!getItemById(itemId)) return error(`No item with id "${itemId}".`)
        return json({ relations: getRelations(itemId) })
      }

      if (!fromId || !toId || !type) {
        return error('fromId, toId, and type are required when action is link.')
      }
      if (!getItemById(fromId)) return error(`No item with id "${fromId}".`)
      if (!getItemById(toId)) return error(`No item with id "${toId}".`)
      if (fromId === toId) return error('An item cannot be linked to itself.')

      const relation = createRelation(fromId, toId, type)
      recordMcpActivity('manage_relations', null, `Linked two items (${type})`, [{ kind: 'delete_relation', id: relation.id }])
      notifyRenderer()
      return json({ created: relation })
    }
  )
}
