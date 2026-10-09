// Types for Checkpoint plugins. Checkpoint writes this file into your plugins
// folder and replaces it when Checkpoint updates, so edits to it don't last.
//
// For autocomplete in your editor, put this line above module.exports:
//   /** @type {import('./checkpoint-plugin').Plugin} */
//
// The full reference is docs/plugins.md in the Checkpoint repository.

/** what a plugin can ask for; you approve exactly this list when you turn it on */
export type Permission = 'read' | 'write' | 'notify'

export interface SettingField {
  /** letters, digits, dots, dashes and underscores, starting with a letter */
  key: string
  label?: string
  /** a secret is stored encrypted and never shown again once saved */
  type?: 'text' | 'secret' | 'number' | 'boolean'
  description?: string
  /** not allowed for a secret */
  default?: string | number | boolean
}

/** read as text and never run, so every value has to be written out literally */
export interface Metadata {
  name: string
  description?: string
  version?: string
  permissions?: Permission[]
  /** the only sites api.fetch can reach, over https; listing one is what asks for the network */
  hosts?: string[]
  /** fields you fill in from Settings, such as a webhook address */
  settings?: SettingField[]
}

export interface Item {
  id: string
  type: 'log' | 'card' | 'task'
  /** the workspace */
  context: string
  title: string
  /** markdown */
  body: string
  /** a card's column id, or a task's status */
  status: string
  /** 0 none, 1 low, 2 medium, 3 high */
  priority: 0 | 1 | 2 | 3
  position: number
  /** unix milliseconds */
  created_at: number
  updated_at: number
  /** midnight UTC for a date with no time of day, any other value is a moment */
  due_at: number | null
  metadata: string
  tags?: { id: string; name: string; color: string }[]
}

/** each needs the read permission, and only arrives for the workspaces you picked */
export interface Events {
  'item:created': { item: Item }
  'item:completed': { item: Item }
  'due:reminded': { itemId: string; title: string }
  'focus:completed': { context: string; durationMs: number }
}

export interface FetchInit {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  /** at most 64 KB, and never with GET or HEAD */
  body?: string
}

export interface FetchResult {
  status: number
  headers: Record<string, string>
  /** at most 1 MB */
  text: string
  /** where it ended up after redirects */
  url: string
}

export interface NewItem {
  context: string
  type: Item['type']
  title: string
  body?: string
  /** a card's column id; an unknown one means the first column */
  status?: string
  priority?: Item['priority']
  due_at?: number | null
  position?: number
}

export type ItemChanges = Partial<Pick<Item, 'title' | 'body' | 'status' | 'priority' | 'due_at' | 'position' | 'context'>>

/** every call returns a promise; one that isn't allowed rejects with a message saying how to allow it */
export interface Api {
  /** the workspaces you picked for this plugin */
  workspaces(): Promise<string[]>
  items: {
    /** read; null for a card outside your workspaces, the same as for one that doesn't exist */
    get(id: string): Promise<Item | null>
    /** read; limit 1 to 200, 50 when left out */
    query(query: { context: string; type: Item['type']; limit?: number }): Promise<Item[]>
    /** write */
    create(item: NewItem): Promise<Item>
    /** write; it can move a card between your workspaces, never out of them */
    update(id: string, changes: ItemChanges): Promise<Item>
  }
  events: {
    /** read; returns a function that stops this handler */
    on<K extends keyof Events>(name: K, handler: (payload: Events[K]) => void | Promise<void>): () => void
  }
  /** notify; quiet hours apply, and it resolves false when nothing was shown */
  notify(title: string, body?: string): Promise<boolean>
  /** https only, to the hosts in metadata */
  fetch(url: string, init?: FetchInit): Promise<FetchResult>
  /** private to this plugin, JSON values, 64 KB each and 1 MB in all; set a key to null to remove it */
  storage: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<true>
  }
  settings: {
    /** what you filled in, its default, or null */
    get(key: string): Promise<string | number | boolean | null>
  }
  /** shows under the plugin's Log button in Settings */
  log(...args: unknown[]): void
}

export interface Plugin {
  metadata: Metadata
  onLoad?(api: Api): void | Promise<void>
  /** optional: stopping a plugin ends its sandbox, timers and all */
  onUnload?(): void | Promise<void>
  [key: string]: unknown
}
