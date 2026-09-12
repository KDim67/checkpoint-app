/**
 * Renderer-side persistence for the board configuration document.
 *
 * The model itself (types, defaults, normalisation, migration) lives in
 * `src/shared/boardModel.ts`, because the MCP server in the main process needs
 * the same logic and cannot import from `src/renderer`. This file is only the
 * IPC-backed read/write half, plus the lock that serialises it.
 *
 * The shared model is re-exported so existing importers of this module keep
 * working unchanged.
 */

import { withLock } from './asyncMutex'
import {
  normalizeBoardConfig,
  migrateLegacy,
  boardConfigKey,
  boardLockKey,
  legacyColumnsKey,
  legacyBackgroundKey,
  legacyArchivedKey,
  legacySwimlanesKey,
  type BoardConfig
} from '../../../shared/boardModel'
import { getSetting, setSetting } from '../data/settings'

export * from '../../../shared/boardModel'

/**
 * Reads and normalises without taking the lock, migrating in memory only.
 * Private: every caller that also writes must hold the lock around both halves,
 * and nesting withLock on the same key would deadlock.
 */
async function readUnlocked(context: string): Promise<{ config: BoardConfig; migrated: boolean }> {
  const stored = await getSetting(boardConfigKey(context))
  if (stored !== null && stored !== undefined && stored !== '') {
    return { config: normalizeBoardConfig(stored), migrated: false }
  }

  const [legacyColumns, legacyBackground, legacyArchived, legacySwimlanes] = await Promise.all([
    getSetting(legacyColumnsKey(context)),
    getSetting(legacyBackgroundKey(context)),
    getSetting(legacyArchivedKey(context)),
    getSetting(legacySwimlanesKey(context))
  ])
  return {
    config: migrateLegacy(legacyColumns, legacyBackground, legacyArchived, legacySwimlanes),
    migrated: true
  }
}

/**
 * Raised on every write of a board document, so a live sharing session can pass
 * it on.
 *
 * The same shape as the `db-mutation` event the item layer raises, and for the
 * same reason: the writer should not have to know a session exists, and the
 * session should not have to poll. Board settings do not go through the item
 * mutation path, which is why they used to reach a peer exactly once, with the
 * opening baseline, and never again.
 */
export const BOARD_CONFIG_EVENT = 'board-config-written'

async function writeUnlocked(context: string, config: BoardConfig): Promise<void> {
  // Passed as an object, so setSetting encodes it exactly once. The legacy
  // column key was stringified by its caller as well, producing a
  // double-encoded value; not repeating that is what keeps reads simple.
  await setSetting(boardConfigKey(context), config)
  window.dispatchEvent(new CustomEvent(BOARD_CONFIG_EVENT, { detail: { context, board: config } }))
}

/**
 * Loads a board's configuration, migrating from the legacy keys the first time.
 * Never rejects: a failed read yields defaults so the board still renders.
 */
export async function loadBoardConfig(context: string): Promise<BoardConfig> {
  try {
    return await withLock(boardLockKey(context), async () => {
      const { config, migrated } = await readUnlocked(context)
      // Written back on first read so the migration happens once rather than on
      // every load. The legacy keys are deliberately left in place for a
      // release as a fallback.
      if (migrated) await writeUnlocked(context, config)
      return config
    })
  } catch (err) {
    console.error('[boardConfig] Could not load board config:', err)
    return normalizeBoardConfig(null)
  }
}

export async function saveBoardConfig(context: string, config: BoardConfig): Promise<void> {
  const normalized = normalizeBoardConfig(config)
  await withLock(boardLockKey(context), () => writeUnlocked(context, normalized))
}

/**
 * Read-modify-write of a subset of the document, serialised against every other
 * config mutation. Returns the stored result.
 *
 * Callers must use this rather than load-then-save: the gap between a separate
 * read and write is exactly where a concurrent AI action block can interleave
 * and lose one side's changes.
 */
export async function patchBoardConfig(
  context: string,
  patch: Partial<BoardConfig>
): Promise<BoardConfig> {
  return withLock(boardLockKey(context), async () => {
    const { config } = await readUnlocked(context)
    const next = normalizeBoardConfig({ ...config, ...patch })
    await writeUnlocked(context, next)
    return next
  })
}

/**
 * The lock key every board-config mutation serialises on. Exported for callers
 * that need to hold it across a wider critical section than a single patch.
 * For example an AI action block that reads the columns, decides which ones are
 * new, and writes, all as one atomic step.
 */
export const boardConfigLockKey = boardLockKey

/**
 * Read half of a caller-managed critical section.
 *
 * ONLY for code already inside `withLock(boardConfigLockKey(context), …)`.
 * Taking the lock again from in there would deadlock, since withLock queues a
 * caller behind the entry that has not finished yet. Everything else should use
 * `loadBoardConfig` or `patchBoardConfig`.
 */
export async function readBoardConfigUnlocked(context: string): Promise<BoardConfig> {
  const { config } = await readUnlocked(context)
  return config
}

/** Write half of a caller-managed critical section. Same locking caveat. */
export async function writeBoardConfigUnlocked(
  context: string,
  config: BoardConfig
): Promise<void> {
  await writeUnlocked(context, normalizeBoardConfig(config))
}

