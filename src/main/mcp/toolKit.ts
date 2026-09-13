/** shared by the MCP tool groups: workspace arg, reply shape, board IO, reload nudge */

// zod/v3 not zod: the SDK types target v3 and the root import breaks AnySchema
import { z } from 'zod/v3'
import { getSetting, setSetting } from '../db'
import {
  normalizeBoardConfig,
  migrateLegacy,
  boardConfigKey,
  legacyColumnsKey,
  legacyBackgroundKey,
  legacyArchivedKey,
  legacySwimlanesKey,
  type BoardConfig
} from '../../shared/boardModel'
import type { Item } from '../../shared/types'

export { z }

/** repeated in every priority tool, the direction isn't guessable */
export const PRIORITY_SCALE = '0 none, 1 low, 2 medium, 3 high.'

/** lets writes nudge the open window to reload */
let onDataChanged: (() => void) | null = null

export function setMcpDataChangedHandler(fn: (() => void) | null): void {
  onDataChanged = fn
}

// explicit workspace, so a UI click mid-task can't retarget an agent
export const context = z.string().describe('Workspace slug. Use list_workspaces to discover valid values.')

/** same legacy migration as the renderer, via shared/boardModel */
export function readBoardConfig(context: string): BoardConfig {
  const stored = getSetting<unknown>(boardConfigKey(context), null)
  if (stored !== null && stored !== undefined && stored !== '') {
    return normalizeBoardConfig(stored)
  }
  return migrateLegacy(
    getSetting<unknown>(legacyColumnsKey(context), null),
    getSetting<unknown>(legacyBackgroundKey(context), null),
    getSetting<unknown>(legacyArchivedKey(context), null),
    getSetting<unknown>(legacySwimlanesKey(context), null)
  )
}

export function writeBoardConfig(context: string, config: BoardConfig): void {
  setSetting(boardConfigKey(context), normalizeBoardConfig(config))
}

/** structured payloads go out as pretty JSON */
export function json(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

export function text(value: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: value }] }
}

/** trimmed, full bodies blow the context on big boards */
export function summarizeItem(item: Item): Record<string, unknown> {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body.length > 500 ? `${item.body.slice(0, 500)}…` : item.body,
    status: item.status,
    priority: item.priority,
    due_at: item.due_at,
    updated_at: item.updated_at,
    tags: (item.tags ?? []).map(t => t.name)
  }
}

export function notifyRenderer(): void {
  try {
    onDataChanged?.()
  } catch (err) {
    console.error('[mcp] Failed to notify renderer:', err)
  }
}
