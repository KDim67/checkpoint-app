/**
 * Which settings belong to a workspace.
 *
 * A workspace is not only its cards. Its board columns, its archived columns,
 * its background, its swimlanes, its backlog layout and every one of its walls
 * live in `app_settings`, not in the `items` table, so an export that copies
 * rows and stops leaves the workspace's entire shape behind. Re-importing it
 * gives you the cards back arranged on a board you never configured.
 *
 * Two rules keep this honest:
 *
 * - **Keys are listed, never scanned for.** A prefix scan for `wall_` would also
 *   sweep up the rail's own width and open state, which are preferences and not
 *   workspace data, and it would claim any future key that happens to start the
 *   same way. Every key here is one this app is known to write.
 * - **Walls have to be read, not derived.** The first wall in a workspace is
 *   keyed by the workspace, but every wall after it is keyed by its own id, so
 *   the only way to find them is to read the index and follow it.
 */

import {
  boardConfigKey, legacyArchivedKey, legacyBackgroundKey, legacyColumnsKey, legacySwimlanesKey
} from './boardModel'
import { DEFAULT_WALL_ID, normalizeWallIndex, wallDocKey, wallIndexKey } from './wallModel'

/** Column widths in the backlog, which the view keys by workspace. */
export const backlogLayoutKey = (context: string): string => `backlog_columns_layout_${context}`

/**
 * The settings keyed directly by workspace name. The legacy board keys are here
 * because a workspace that has not been opened since the board config was
 * consolidated still holds its columns in them, and an export that skipped them
 * would silently flatten that workspace to the defaults.
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

/**
 * The document key of every wall the workspace has, given its stored index.
 * Falls back to the first wall alone when there is no index, which is what a
 * workspace that predates several-walls-per-workspace looks like.
 */
export function wallDocKeysFor(context: string, storedIndex: unknown): string[] {
  return normalizeWallIndex(storedIndex).walls.map(w => wallDocKey(context, w.id))
}

/**
 * Every settings key belonging to a workspace, in the order they should be
 * read. Duplicates are removed: the first wall appears both as a direct key and
 * through the index.
 */
export function contextSettingKeys(context: string, storedIndex: unknown): string[] {
  return [...new Set([...directContextSettingKeys(context), ...wallDocKeysFor(context, storedIndex)])]
}

// Importing into a different workspace

export interface SettingEntry {
  key: string
  /** The value exactly as stored, a JSON string, not a parsed value. */
  value: string
}

/**
 * Rewrites an exported workspace's settings for the workspace they are being
 * imported into.
 *
 * The walls are the delicate part. A wall after the first is keyed by its own
 * id and by nothing else, so copying the index across verbatim would leave two
 * workspaces pointing at the *same* documents, editing a wall in one would
 * change it in the other, and deleting the workspace would take the other's
 * walls with it. Every non-first wall therefore gets a fresh id, and the index
 * is rewritten to match.
 *
 * `newWallId` is injected rather than generated here so the result is
 * reproducible under test.
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
    // The first wall keeps its id: its key is derived from the workspace, which
    // is already changing, so there is nothing left to collide with.
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
