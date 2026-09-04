/**
 * Which settings belong to a workspace. Columns, background, swimlanes, backlog
 * layout and walls all live in app_settings, so an export of `items` alone
 * loses the workspace's whole shape.
 *
 * Keys are listed, not prefix-scanned: `wall_*` would also catch the rail's
 * own preferences.
 */

import {
  boardConfigKey, legacyArchivedKey, legacyBackgroundKey, legacyColumnsKey, legacySwimlanesKey
} from './boardModel'
import { DEFAULT_WALL_ID, normalizeWallIndex, wallDocKey, wallIndexKey } from './wallModel'

/** Column widths in the backlog, which the view keys by workspace. */
export const backlogLayoutKey = (context: string): string => `backlog_columns_layout_${context}`

/**
 * Keyed directly by workspace name. Legacy board keys included: a workspace not
 * opened since the config was consolidated still keeps its columns in them.
 */
export function directContextSettingKeys(context: string): string[] {
  return [
    boardConfigKey(context),
    legacyColumnsKey(context),
    legacyBackgroundKey(context),
    legacyArchivedKey(context),
    legacySwimlanesKey(context),
    backlogLayoutKey(context),
    wallIndexKey(context),
    // The first wall. Later ones are found through the index.
    wallDocKey(context)
  ]
}

/** Every wall's doc key. No index means one wall. A pre-multi-wall workspace. */
export function wallDocKeysFor(context: string, storedIndex: unknown): string[] {
  return normalizeWallIndex(storedIndex).walls.map(w => wallDocKey(context, w.id))
}

/** Deduped: the first wall shows up as a direct key and through the index. */
export function contextSettingKeys(context: string, storedIndex: unknown): string[] {
  return [...new Set([...directContextSettingKeys(context), ...wallDocKeysFor(context, storedIndex)])]
}

// Importing into a different workspace

export interface SettingEntry {
  key: string
  /** Exactly as stored. A JSON string, not a parsed value. */
  value: string
}

/**
 * Re-keys an exported workspace's settings for the one it lands in.
 *
 * Walls after the first are keyed by id alone, so copying the index verbatim
 * would leave both workspaces sharing the same documents. They get fresh ids.
 * `newWallId` is injected so tests are reproducible.
 */
export function remapContextSettings(
  settings: Record<string, string>,
  fromContext: string,
  toContext: string,
  newWallId: () => string
): SettingEntry[] {
  const out = new Map<string, string>()

  const from = directContextSettingKeys(fromContext)
  const to = directContextSettingKeys(toContext)
  from.forEach((key, i) => {
    const value = settings[key]
    if (typeof value === 'string') out.set(to[i], value)
  })

  const storedIndex = settings[wallIndexKey(fromContext)]
  if (storedIndex === undefined) return [...out].map(([key, value]) => ({ key, value }))

  const index = normalizeWallIndex(storedIndex)
  const idMap = new Map<string, string>()
  for (const wall of index.walls) {
    // First wall keeps its id. Its key already changes with the workspace.
    idMap.set(wall.id, wall.id === DEFAULT_WALL_ID ? DEFAULT_WALL_ID : newWallId())
  }

  for (const wall of index.walls) {
    const value = settings[wallDocKey(fromContext, wall.id)]
    if (typeof value === 'string') {
      out.set(wallDocKey(toContext, idMap.get(wall.id) as string), value)
    }
  }

  out.set(wallIndexKey(toContext), JSON.stringify({
    ...index,
    walls: index.walls.map(w => ({ ...w, id: idMap.get(w.id) as string })),
    activeId: idMap.get(index.activeId) ?? DEFAULT_WALL_ID
  }))

  return [...out].map(([key, value]) => ({ key, value }))
}
