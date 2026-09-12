/**
 * What every group of MCP tools shares: the workspace argument, the shape of a
 * reply, how a board is read and written, and the nudge that tells the open
 * window to reload.
 */

// 'zod/v3', not 'zod'. Zod 3.25 ships the v3 and v4 APIs under separate
// subpaths, and the SDK's schema types are declared against `zod/v3`. Importing
// the package root yields a nominally different ZodTypeAny, which fails to
// satisfy the SDK's AnySchema and buries the real errors under
// "type instantiation is excessively deep".
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

/** Repeated in every tool that takes a priority; the direction is not guessable. */
export const PRIORITY_SCALE = '0 none, 1 low, 2 medium, 3 high.'

/** Set by the owner so writes can nudge the open window to reload. */
let onDataChanged: (() => void) | null = null

export function setMcpDataChangedHandler(fn: (() => void) | null): void {
  onDataChanged = fn
}

// Every tool takes an explicit workspace rather than reading the app's active
// context: an agent's target must not silently change because the user
// clicked something in the UI mid-task.
export const context = z.string().describe('Workspace slug. Use list_workspaces to discover valid values.')

// Board config access (main-process side)

/**
 * Reads a board document, running the same legacy migration the renderer does.
 * Shares `src/shared/boardModel` with the renderer and the AI action blocks, so
 * there is exactly one definition of what a board's configuration means.
 */
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

// Tool helpers

/** Every tool returns text; structured payloads go out as pretty JSON. */
export function json(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

export function text(value: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: value }] }
}

/** Trimmed for transport: full bodies would blow the context on a large board. */
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
