/** user-meaningful moments, not internal calls, so it stays stable as the code moves */

import type { Item } from '../shared/types'

interface PluginEventMap {
  /** by anyone: UI, agent or webhook */
  'item:created': { item: Item }
  /** moved into a finished state */
  'item:completed': { item: Item }
  'focus:completed': { context: string; durationMs: number }
  'due:reminded': { itemId: string; title: string }
}

export type PluginEventName = keyof PluginEventMap
export type PluginEventHandler<K extends PluginEventName> = (payload: PluginEventMap[K]) => void

const listeners = new Map<PluginEventName, Set<PluginEventHandler<PluginEventName>>>()

export function onPluginEvent<K extends PluginEventName>(
  name: K,
  handler: PluginEventHandler<K>
): () => void {
  const set = listeners.get(name) ?? new Set()
  set.add(handler as PluginEventHandler<PluginEventName>)
  listeners.set(name, set)
  return () => {
    set.delete(handler as PluginEventHandler<PluginEventName>)
  }
}

/** handlers isolated: called inside db writes, a throw would look like a failed card creation */
export function emitPluginEvent<K extends PluginEventName>(name: K, payload: PluginEventMap[K]): void {
  const set = listeners.get(name)
  if (!set || set.size === 0) return
  for (const handler of [...set]) {
    try {
      handler(payload)
    } catch (err) {
      console.error(`[PluginEvents] A handler for "${name}" threw:`, err)
    }
  }
}

/** for tests and full teardown */
export function clearPluginEvents(): void {
  listeners.clear()
}

export function pluginEventListenerCount(name: PluginEventName): number {
  return listeners.get(name)?.size ?? 0
}
