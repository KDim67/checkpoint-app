/**
 * The events plugins can react to.
 *
 * Plugins were previously given `app`, `BrowserWindow`, an IPC channel and a
 * logger, everything needed to run code at startup and nothing to run it *in
 * response to* anything. A plugin that cannot observe the app can only poke at
 * Electron internals, which is both useless and the least safe thing it could do.
 *
 * The set is deliberately small and describes user-meaningful moments rather
 * than internal calls, so it can stay stable while the code underneath changes.
 */

import type { Item } from '../shared/types'

export interface PluginEventMap {
  /** A card, task or log entry was created, by anyone, UI, agent or webhook. */
  'item:created': { item: Item }
  /** An item moved into a finished state. */
  'item:completed': { item: Item }
  /** A focus session finished and was recorded. */
  'focus:completed': { context: string; durationMs: number }
  /** A due-date reminder was raised. */
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

/**
 * Delivers an event to every subscriber.
 *
 * Each handler is isolated: a plugin that throws must not take down the write
 * that emitted the event, nor stop the other plugins from hearing it. This is
 * called from inside database writes, so a throw here would surface as a failed
 * card creation with no obvious cause.
 */
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

/** Used by tests and by a full teardown of the plugin system. */
export function clearPluginEvents(): void {
  listeners.clear()
}

export function pluginEventListenerCount(name: PluginEventName): number {
  return listeners.get(name)?.size ?? 0
}
