/** IPC read/write half plus its lock; the model lives in shared/boardModel for MCP */

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

/** private: writers must hold the lock around both halves, nesting would deadlock */
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

/** raised on every board write so a live session can relay it; board settings skip the item mutation path */
export const BOARD_CONFIG_EVENT = 'board-config-written'

async function writeUnlocked(context: string, config: BoardConfig): Promise<void> {
  // an object, so setSetting encodes once; the legacy key got double-encoded
  await setSetting(boardConfigKey(context), config)
  window.dispatchEvent(new CustomEvent(BOARD_CONFIG_EVENT, { detail: { context, board: config } }))
}

/** never rejects, a failed read yields defaults */
export async function loadBoardConfig(context: string): Promise<BoardConfig> {
  try {
    return await withLock(boardLockKey(context), async () => {
      const { config, migrated } = await readUnlocked(context)
      // written back once; legacy keys stay a release as fallback
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

/** serialised read-modify-write; load-then-save lets an AI block interleave */
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

/** for callers holding it across a wider critical section */
export const boardConfigLockKey = boardLockKey

/** only inside withLock(boardConfigLockKey), relocking would deadlock */
export async function readBoardConfigUnlocked(context: string): Promise<BoardConfig> {
  const { config } = await readUnlocked(context)
  return config
}

/** same locking caveat */
export async function writeBoardConfigUnlocked(
  context: string,
  config: BoardConfig
): Promise<void> {
  await writeUnlocked(context, normalizeBoardConfig(config))
}

