/** workspace shape lives in app_settings; keys listed, a wall_* scan would catch rail prefs */

import {
  boardConfigKey, legacyArchivedKey, legacyBackgroundKey, legacyColumnsKey, legacySwimlanesKey
} from './boardModel'
import { DEFAULT_WALL_ID, normalizeWallIndex, wallDocKey, wallIndexKey } from './wallModel'

export const backlogLayoutKey = (context: string): string => `backlog_columns_layout_${context}`

/** legacy keys too, an unopened workspace still keeps columns there */
export function directContextSettingKeys(context: string): string[] {
  return [
    boardConfigKey(context),
    legacyColumnsKey(context),
    legacyBackgroundKey(context),
    legacyArchivedKey(context),
    legacySwimlanesKey(context),
    backlogLayoutKey(context),
    wallIndexKey(context),
    // first wall, later ones via the index
    wallDocKey(context)
  ]
}

/** no index means one wall */
export function wallDocKeysFor(context: string, storedIndex: unknown): string[] {
  return normalizeWallIndex(storedIndex).walls.map(w => wallDocKey(context, w.id))
}

/** deduped, the first wall appears twice */
export function contextSettingKeys(context: string, storedIndex: unknown): string[] {
  return [...new Set([...directContextSettingKeys(context), ...wallDocKeysFor(context, storedIndex)])]
}

interface SettingEntry {
  key: string
  /** JSON string, as stored */
  value: string
}

/** later walls get fresh ids or two workspaces share docs; newWallId injected for tests */
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
    // the first wall keeps its id, its key changes with the workspace
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
