import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import type { McpActivityEntry } from '../shared/mcpActivity'

import type { RecurrenceSummary } from '../shared/recurrence'
import type { NotificationCategory, NotificationPolicy } from '../shared/notificationPolicy'
import type { Subtask } from '../shared/subtasks'
import type { StartupSettings } from '../shared/startupSettings'
import type { ModelCapabilities } from '../shared/modelCapabilities'
import type { ImportedBoard } from '../shared/foreignImport'
import type {
  Item,
  Tag,
  CreateItemPayload,
  CreateTagPayload,
  PaginatedResult,
  Relation,
  RelationType,
  AiStreamParams,
  AiUsage,
  AiStructuredParams,
  AiStructuredResult,
  BulkUpdatePayload,
  SearchQuery,
  TaskQueryParams,
  HardwareSpecs,
  OllamaStatus,
  PullProgressEvent,
  FocusSession,
  CreateFocusSessionPayload,
  NoteMetadata,
  NoteSearchResult,
  GitCommit,
  GitStatusResult,
  ClipboardItem,
  AnalyticsData,
  PluginInfo,
  ShortcutMap,
  AiMemory,
  CreateMemoryPayload,
  ContextExport,
  WorkspaceFileInfo,
  SyncPayload
} from '../shared/types'

/** One file offered by a sync peer. */
interface SyncFileEntry {
  relPath: string
  mtime: number
  size: number
  sha256: string
}

/**
 * Secure IPC bridge, exposes a typed API surface to the renderer.
 *
 * CRITICAL PATTERN: Every ipcRenderer.on() subscription MUST return an
 * explicit cleanup/unsubscribe function. React components call this in their
 * useEffect return to prevent zombie listeners and memory leaks after unmount.
 */

const api = {
  // App
  app: {
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    },
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.APP_GET_VERSION),
    getDataPath: (): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.APP_GET_DATA_PATH),
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.APP_OPEN_EXTERNAL, url),
    minimize: (): void => ipcRenderer.send(IpcChannels.APP_MINIMIZE),
    maximize: (): void => ipcRenderer.send(IpcChannels.APP_MAXIMIZE),
    close: (): void => ipcRenderer.send(IpcChannels.APP_CLOSE),
    saveFile: (defaultName: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.APP_SAVE_FILE, defaultName, content),
    showItemInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.APP_SHOW_ITEM_IN_FOLDER, filePath),
    // Electron ≥32 removed File.path from renderer File objects, this is the
    // only sanctioned way to resolve the absolute path of a dropped file.
    getPathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    },
    onNavigateToView: (callback: (view: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, view: string) => callback(view)
      ipcRenderer.on(IpcChannels.APP_NAVIGATE_TO_VIEW, handler)
      return () => ipcRenderer.removeListener(IpcChannels.APP_NAVIGATE_TO_VIEW, handler)
    }
  },

  // Database
  db: {
    getItems: async (
      context: string,
      type: string,
      page: number,
      pageSize: number
    ): Promise<PaginatedResult<Item>> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_ITEMS, context, type, page, pageSize)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    createItem: async (
      payload: CreateItemPayload,
      tagIds: string[] = []
    ): Promise<Item> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_CREATE_ITEM, payload, tagIds)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'createItem', item: res.data, tagIds } }))
      return res.data
    },

    updateItem: async (
      id: string,
      patch: Partial<Item>,
      tagIds?: string[]
    ): Promise<Item> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_UPDATE_ITEM, id, patch, tagIds)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'updateItem', item: res.data, tagIds } }))
      return res.data
    },

    deleteItem: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_DELETE_ITEM, id)
      if (!res.success) throw new Error(res.error)
      // The context travels with the event because the item is gone by the time
      // any listener runs. Collaboration filters outgoing mutations by
      // workspace, and without this a delete had no workspace to be filtered
      // by, so deletions from every workspace were broadcast to the peer.
      window.dispatchEvent(
        new CustomEvent('db-mutation', { detail: { type: 'deleteItem', id, context: res.data?.context ?? null } })
      )
    },

    getTags: async (): Promise<Tag[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_TAGS)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    createTag: async (payload: CreateTagPayload): Promise<Tag> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_CREATE_TAG, payload)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'createTag', tag: res.data } }))
      return res.data
    },

    updateTag: async (id: string, payload: Partial<CreateTagPayload>): Promise<Tag> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_UPDATE_TAG, id, payload)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'updateTag', tag: res.data } }))
      return res.data
    },

    deleteTag: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_DELETE_TAG, id)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'deleteTag', id } }))
    },

    getSetting: async (key: string): Promise<unknown> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_SETTING, key)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    setSetting: async (key: string, value: unknown): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_SET_SETTING, key, value)
      if (!res.success) throw new Error(res.error)
    },

    getRelations: async (itemId: string): Promise<Relation[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_RELATIONS, itemId)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    createRelation: async (fromId: string, toId: string, type: RelationType): Promise<Relation> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_CREATE_RELATION, fromId, toId, type)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'createRelation', relation: res.data } }))
      return res.data
    },

    deleteRelation: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_DELETE_RELATION, id)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'deleteRelation', id } }))
    },

    searchItems: async (query: SearchQuery): Promise<PaginatedResult<Item>> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_SEARCH_ITEMS, query)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    getContexts: async (): Promise<string[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_CONTEXTS)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    bulkUpdateItems: async (payload: BulkUpdatePayload): Promise<{ updated: number }> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_BULK_UPDATE_ITEMS, payload)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'bulkUpdateItems', payload } }))
      return res.data
    },

    bulkDeleteItems: async (ids: string[]): Promise<{ deleted: number }> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_BULK_DELETE_ITEMS, ids)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'bulkDeleteItems', ids } }))
      return res.data
    },

    rebalancePositions: async (context: string, status: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_REBALANCE_POSITIONS, context, status)
      if (!res.success) throw new Error(res.error)
      window.dispatchEvent(new CustomEvent('db-mutation', { detail: { type: 'rebalancePositions', context, status } }))
    },

    queryTasks: async (context: string, params: TaskQueryParams): Promise<PaginatedResult<Item>> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_QUERY_TASKS, context, params)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    createFocusSession: async (payload: CreateFocusSessionPayload): Promise<FocusSession> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_CREATE_FOCUS_SESSION, payload)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    getFocusSessions: async (context: string): Promise<FocusSession[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_FOCUS_SESSIONS, context)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    exportContext: async (context: string, contextName: string): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.DB_EXPORT_CONTEXT, context, contextName)
    },

    /**
     * Opens a file and classifies it: `payload` for Checkpoint's own export,
     * `foreign` for a board exported from another app. Exactly one is set.
     */
    importContext: async (): Promise<{
      success: boolean
      payload?: ContextExport
      foreign?: ImportedBoard
      cancelled?: boolean
      error?: string
    }> => {
      return ipcRenderer.invoke(IpcChannels.DB_IMPORT_CONTEXT)
    },

    importContextData: async (newContextSlug: string, data: ContextExport): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.DB_IMPORT_CONTEXT_DATA, newContextSlug, data)
    },

    renameContext: async (oldSlug: string, newSlug: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.DB_RENAME_CONTEXT, oldSlug, newSlug)
    }
  },

  // AI Streaming
  // streamId identifies the consumer channel ('assistant', 'standup', …) so
  // several features can stream concurrently. Subscribers receive the id and
  // filter to their own stream; omitting it preserves legacy global behavior.
  ai: {
    startStream: (params: AiStreamParams, streamId?: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.AI_STREAM_START, params, streamId),

    abortStream: (streamId?: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.AI_STREAM_ABORT, streamId),

    testConnection: (baseURL: string, apiKey: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.AI_TEST_CONNECTION, baseURL, apiKey),

    generateStructured: (params: AiStructuredParams): Promise<AiStructuredResult> =>
      ipcRenderer.invoke(IpcChannels.AI_GENERATE_STRUCTURED, params),

    abortStructured: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.AI_GENERATE_ABORT),

    getCapabilities: (model: string, force?: boolean): Promise<ModelCapabilities> =>
      ipcRenderer.invoke(IpcChannels.AI_GET_CAPABILITIES, model, force),

    listModels: (): Promise<{ ok: boolean; models: string[]; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.AI_LIST_MODELS),

    // Returns an unsubscribe function, MUST be called on component unmount
    onChunk: (callback: (chunk: string, streamId?: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, chunk: string, streamId?: string) => callback(chunk, streamId)
      ipcRenderer.on(IpcChannels.AI_CHUNK, handler)
      return () => ipcRenderer.removeListener(IpcChannels.AI_CHUNK, handler)
    },

    onDone: (callback: (streamId?: string, usage?: AiUsage) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, streamId?: string, usage?: AiUsage) => callback(streamId, usage)
      ipcRenderer.on(IpcChannels.AI_DONE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.AI_DONE, handler)
    },

    onError: (callback: (errMessage: string, streamId?: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, errMessage: string, streamId?: string) => callback(errMessage, streamId)
      ipcRenderer.on(IpcChannels.AI_ERROR, handler)
      return () => ipcRenderer.removeListener(IpcChannels.AI_ERROR, handler)
    }
  },

  // Widget
  widget: {
    toggle: (active: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WIDGET_TOGGLE, active),
    setPosition: (pos: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WIDGET_SET_POSITION, pos),
    setOpacity: (opacity: number): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WIDGET_SET_OPACITY, opacity)
  },

  // Theme hot-reload
  onThemeUpdate: (callback: (css: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, css: string) => callback(css)
    ipcRenderer.on(IpcChannels.THEME_UPDATE, handler)
    return () => ipcRenderer.removeListener(IpcChannels.THEME_UPDATE, handler)
  },

  // HUD
  hud: {
    toggle: (active?: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.HUD_TOGGLE, active),

    onToggle: (callback: (visible: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, visible: boolean) => callback(visible)
      ipcRenderer.on(IpcChannels.HUD_ON_TOGGLE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.HUD_ON_TOGGLE, handler)
    },

    onReset: (callback: () => void): (() => void) => {
      const handler = () => callback()
      ipcRenderer.on('hud:reset', handler)
      return () => ipcRenderer.removeListener('hud:reset', handler)
    },

    resize: (height: number): void => {
      ipcRenderer.send('hud:resize', height)
    }
  },

  // Webhook
  webhook: {
    toggle: (active: boolean, port: number): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WEBHOOK_TOGGLE, active, port),

    onEvent: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on(IpcChannels.WEBHOOK_EVENT, handler)
      return () => ipcRenderer.removeListener(IpcChannels.WEBHOOK_EVENT, handler)
    }
  },

  tray: {
    summary: (): Promise<{ context: string; overdue: number; dueToday: number; open: number }> =>
      ipcRenderer.invoke(IpcChannels.TRAY_SUMMARY),
    action: (action: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IpcChannels.TRAY_ACTION, action),
    /** Fires when the startup settings change in any window. */
    onStartupChanged: (callback: (settings: StartupSettings) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, settings: StartupSettings): void => callback(settings)
      ipcRenderer.on(IpcChannels.STARTUP_CHANGED, listener)
      return () => ipcRenderer.removeListener(IpcChannels.STARTUP_CHANGED, listener)
    },
    /** The panel measures its own content and asks to be sized to it. */
    resize: (height: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IpcChannels.TRAY_RESIZE, height),
    getStartup: (): Promise<StartupSettings> => ipcRenderer.invoke(IpcChannels.STARTUP_GET),
    setStartup: (settings: StartupSettings): Promise<StartupSettings> =>
      ipcRenderer.invoke(IpcChannels.STARTUP_SET, settings)
  },

  subtasks: {
    list: (itemId: string): Promise<Subtask[]> => ipcRenderer.invoke(IpcChannels.SUBTASK_LIST, itemId),
    add: (itemId: string, title: string): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke(IpcChannels.SUBTASK_ADD, itemId, title),
    update: (id: string, patch: { title?: string; done?: boolean; position?: number }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IpcChannels.SUBTASK_UPDATE, id, patch),
    remove: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IpcChannels.SUBTASK_DELETE, id),
    /** Converts the markdown checkboxes in a task body into real subtasks. */
    convert: (itemId: string): Promise<{ ok: boolean; converted?: number; reason?: string }> =>
      ipcRenderer.invoke(IpcChannels.SUBTASK_CONVERT, itemId)
  },

  exporter: {
    /** Opens a save dialog and writes the chosen format. */
    items: (options: {
      context: string | null
      format: 'markdown' | 'csv' | 'json'
    }): Promise<{ ok: boolean; filePath?: string; count?: number; reason?: string }> =>
      ipcRenderer.invoke(IpcChannels.EXPORT_ITEMS, options)
  },

  notifications: {
    /** Raises a notification through the shared policy. Resolves to whether it fired. */
    send: (input: {
      category: NotificationCategory
      title: string
      body: string
      dedupeKey?: string
      dedupeWindowMs?: number
      itemId?: string
    }): Promise<boolean> => ipcRenderer.invoke(IpcChannels.NOTIFY_SEND, input),
    getPolicy: (): Promise<NotificationPolicy> => ipcRenderer.invoke(IpcChannels.NOTIFY_GET_POLICY),
    setPolicy: (policy: NotificationPolicy): Promise<NotificationPolicy> =>
      ipcRenderer.invoke(IpcChannels.NOTIFY_SET_POLICY, policy),
    onActivated: (callback: (payload: { itemId?: string }) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, payload: { itemId?: string }): void => callback(payload)
      ipcRenderer.on(IpcChannels.NOTIFY_ACTIVATED, listener)
      return () => ipcRenderer.removeListener(IpcChannels.NOTIFY_ACTIVATED, listener)
    }
  },

  recurrence: {
    list: (context?: string): Promise<RecurrenceSummary[]> =>
      ipcRenderer.invoke(IpcChannels.RECURRENCE_LIST, context),
    create: (input: {
      context: string
      title: string
      body?: string
      type?: 'card' | 'task'
      status?: string
      priority?: number
      rule: { freq: string; interval?: number; byWeekday?: number[]; startAt: number; untilAt?: number | null }
    }): Promise<{ ok: boolean; id?: string; reason?: string }> =>
      ipcRenderer.invoke(IpcChannels.RECURRENCE_CREATE, input),
    remove: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IpcChannels.RECURRENCE_DELETE, id),
    setActive: (id: string, active: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IpcChannels.RECURRENCE_SET_ACTIVE, id, active)
  },

  mcp: {
    /** Resolves to the bound port, or null when stopping. Rejects on port clash. */
    toggle: (active: boolean, port: number): Promise<number | null> =>
      ipcRenderer.invoke(IpcChannels.MCP_TOGGLE, active, port),

    getStatus: (): Promise<{ running: boolean; port: number; enabled: boolean; token: string }> =>
      ipcRenderer.invoke(IpcChannels.MCP_GET_STATUS),

    listActivity: (limit?: number): Promise<McpActivityEntry[]> =>
      ipcRenderer.invoke(IpcChannels.MCP_ACTIVITY_LIST, limit),
    undoActivity: (id: string): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke(IpcChannels.MCP_ACTIVITY_UNDO, id),
    regenerateToken: (): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.MCP_REGENERATE_TOKEN),

    /** Fires when an MCP client changed data behind the UI's back. */
    onDataChanged: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on(IpcChannels.MCP_DATA_CHANGED, handler)
      return () => ipcRenderer.removeListener(IpcChannels.MCP_DATA_CHANGED, handler)
    }
  },

  // Backup
  backup: {
    run: (action?: 'backup' | 'restore' | 'delete' | 'init', filename?: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.BACKUP_RUN, action, filename),
    getStatus: (): Promise<{
      enabled: boolean
      interval: string
      path: string
      maxCount: number
      backups: { filename: string; timestamp: number; size: number }[]
    }> => ipcRenderer.invoke(IpcChannels.BACKUP_STATUS)
  },

  // Activity Tracker
  tracker: {
    toggle: (active: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.TRACKER_TOGGLE, active),
    getState: (): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.TRACKER_GET_STATE),
    getActivityStats: async (context: string | null, start: number, end: number): Promise<{
      totalDurationMs: number
      byProcess: Array<{ processName: string; durationMs: number }>
      byContext: Array<{ context: string; durationMs: number }>
      byTitle: Array<{ windowTitle: string; processName: string; durationMs: number }>
    }> => {
      // The TRACKER_GET_STATS handler wraps its result in handleSafe's
      // { success, data } envelope, unwrap it here so callers get the stats
      // object directly (matching the db.* methods and this return type).
      const res = await ipcRenderer.invoke(IpcChannels.TRACKER_GET_STATS, context, start, end)
      if (!res.success) throw new Error(res.error)
      return res.data
    }
  },

  // Hardware profiling (AI Cookbook)
  hardware: {
    getSpecs: (): Promise<unknown> =>
      ipcRenderer.invoke(IpcChannels.HARDWARE_GET_SPECS)
  },

  // Ollama (AI Cookbook)
  ollama: {
    check: (): Promise<unknown> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_CHECK_INSTALLED),

    listLocal: (): Promise<string[]> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_LIST_LOCAL),

    pull: (modelTag: string, modelId: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_PULL, modelTag, modelId),

    stop: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_STOP),

    delete: (modelTag: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_DELETE, modelTag),

    onPullProgress: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, event: unknown) => callback(event)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_PROGRESS, handler)
    },

    onPullDone: (callback: (modelId: string) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, modelId: string) => callback(modelId)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_DONE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_DONE, handler)
    },

    onPullError: (callback: (modelId: string, error: string) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, modelId: string, error: string) =>
        callback(modelId, error)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_ERROR, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_ERROR, handler)
    }
  },

  cookbook: {
    getHardwareSpecs: (): Promise<HardwareSpecs> =>
      ipcRenderer.invoke(IpcChannels.HARDWARE_GET_SPECS),

    checkOllama: (): Promise<OllamaStatus> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_CHECK_INSTALLED),

    pullModel: (modelTag: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_PULL, modelTag),

    stopPull: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_STOP),

    deleteModel: (modelTag: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_DELETE, modelTag),

    listLocalModels: (): Promise<string[]> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_LIST_LOCAL),

    onPullProgress: (callback: (event: PullProgressEvent) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, event: PullProgressEvent) => callback(event)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_PROGRESS, handler)
    },

    onPullDone: (callback: (data: { modelTag: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, data: { modelTag: string }) => callback(data)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_DONE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_DONE, handler)
    },

    onPullError: (callback: (data: { modelTag: string; message: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, data: { modelTag: string; message: string }) => callback(data)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_ERROR, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_ERROR, handler)
    }
  },

  notes: {
    listNotes: (): Promise<NoteMetadata[]> =>
      ipcRenderer.invoke(IpcChannels.NOTES_LIST),
    readNote: (title: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.NOTES_READ, title),
    writeNote: (title: string, content: string, oldTitle?: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.NOTES_WRITE, title, content, oldTitle),
    deleteNote: (title: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.NOTES_DELETE, title),
    searchNotes: (query: string): Promise<NoteSearchResult[]> =>
      ipcRenderer.invoke(IpcChannels.NOTES_SEARCH, query)
  },

  git: {
    checkRepo: (path: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.GIT_CHECK, path),
    getStatus: (path: string): Promise<GitStatusResult> =>
      ipcRenderer.invoke(IpcChannels.GIT_STATUS, path),
    getLog: (path: string): Promise<GitCommit[]> =>
      ipcRenderer.invoke(IpcChannels.GIT_LOG, path)
  },

  clipboard: {
    getHistory: async (): Promise<ClipboardItem[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_GET_HISTORY)
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    togglePin: async (id: string, isPinned: boolean): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_TOGGLE_PIN, id, isPinned)
      if (!res.success) throw new Error(res.error)
    },
    updateLabel: async (id: string, label: string | null): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_UPDATE_LABEL, id, label)
      if (!res.success) throw new Error(res.error)
    },
    deleteItem: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_DELETE_ITEM, id)
      if (!res.success) throw new Error(res.error)
    },
    clearHistory: async (): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_CLEAR_HISTORY)
      if (!res.success) throw new Error(res.error)
    },
    createSnippet: async (content: string, label: string | null): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_CREATE_SNIPPET, content, label)
      if (!res.success) throw new Error(res.error)
    },
    restoreItem: async (content: string, isPinned: boolean, label: string | null): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_RESTORE_ITEM, content, isPinned, label)
      if (!res.success) throw new Error(res.error)
    },
    paste: (content: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CLIPBOARD_PASTE, content),
    onHistoryChanged: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on(IpcChannels.CLIPBOARD_HISTORY_CHANGED, handler)
      return () => ipcRenderer.removeListener(IpcChannels.CLIPBOARD_HISTORY_CHANGED, handler)
    }
  },

  analytics: {
    getAnalytics: (context?: string | null): Promise<AnalyticsData> =>
      ipcRenderer.invoke(IpcChannels.ANALYTICS_GET_DATA, context)
  },

  customizer: {
    toggleEngine: (active: boolean): Promise<void> =>
      ipcRenderer.invoke('customizer:toggleEngine', active),
    getEngineState: (): Promise<boolean> =>
      ipcRenderer.invoke('customizer:getEngineState'),
    updateTheme: (vars: Record<string, string>): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_UPDATE_THEME, vars),
    /** The CSS to apply right now. Empty when the engine is off. */
    getCss: (): Promise<string> => ipcRenderer.invoke(IpcChannels.CUSTOMIZER_GET_CSS),
    getTheme: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke('customizer:getTheme'),
    getPlugins: (): Promise<PluginInfo[]> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_GET_PLUGINS),
    /** Resolves to why it failed, so a broken plugin does not silently stay off. */
    togglePlugin: (filename: string, active: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_TOGGLE_PLUGIN, filename, active),
    openPluginsFolder: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_OPEN_PLUGINS_FOLDER),
    /** Writes a shipped example into the plugins folder. It is not enabled by this. */
    installExample: (filename: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_INSTALL_EXAMPLE, filename),
    registerShortcuts: (shortcuts: ShortcutMap): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_REGISTER_SHORTCUTS, shortcuts),
    getShortcuts: (): Promise<ShortcutMap> =>
      ipcRenderer.invoke('customizer:getShortcuts')
  },

  cheatsheets: {
    list: (): Promise<Array<{ name: string; path: string; size: number; mtime: number }>> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_LIST),
    add: (filePath: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_ADD, filePath),
    remove: (name: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_REMOVE, name),
    rename: (oldName: string, newName: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_RENAME, oldName, newName),
    selectFile: (): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_SELECT),
    getText: (name: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_GET_TEXT, name),
    getRelevant: (name: string, query: string, maxChars?: number): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_GET_RELEVANT, name, query, maxChars),
    search: (query: string): Promise<Array<{ name: string; matchCount: number; snippets: string[] }>> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_SEARCH, query)
  },
  gamedev: {
    batchRename: (files: Array<{ oldPath: string; newPath: string }>): Promise<{
      success: boolean
      renamedCount: number
      errors: Array<{ oldPath: string; newPath: string; error: string }>
    }> => ipcRenderer.invoke(IpcChannels.GAMEDEV_BATCH_RENAME, files),
    selectTexture: (): Promise<{ path: string; dataUrl: string } | null> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SELECT_TEXTURE),
    loadTexture: (path: string): Promise<{ path: string; dataUrl: string } | null> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_LOAD_TEXTURE, path),
    saveMaps: (params: { albedoPath: string; maps: { normal?: string; height?: string; roughness?: string; ao?: string } }): Promise<{ success: boolean; writtenFiles: string[]; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_MAPS, params),
    saveSeamless: (params: { originalPath: string; dataUrl: string }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_SEAMLESS, params),
    selectSpriteFolder: (): Promise<{ path: string; files: Array<{ name: string; path: string; dataUrl: string }> } | null> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SELECT_SPRITE_FOLDER),
    saveSpriteAtlas: (params: { folderPath: string; atlasDataUrl: string; atlasJson: string }): Promise<{ success: boolean; pngPath?: string; jsonPath?: string; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_SPRITE_ATLAS, params),
    saveSlices: (params: { originalPath: string; files: Array<{ index: number; dataUrl: string }> }): Promise<{ success: boolean; count: number; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_SLICES, params),
    saveLut: (params: { originalPath: string; dataUrl: string }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_LUT, params),
    saveUpscaled: (params: { originalPath: string; suffix: string; dataUrl: string }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_UPSCALED, params)
  },
  memory: {
    getMemories: (context?: string): Promise<AiMemory[]> =>
      ipcRenderer.invoke(IpcChannels.AI_GET_MEMORIES, context),
    saveMemory: (payload: CreateMemoryPayload): Promise<AiMemory> =>
      ipcRenderer.invoke(IpcChannels.AI_SAVE_MEMORY, payload),
    deleteMemory: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.AI_DELETE_MEMORY, id),
    searchMemories: (query: string, context?: string, limit?: number): Promise<AiMemory[]> =>
      ipcRenderer.invoke(IpcChannels.AI_SEARCH_MEMORIES, query, context, limit),
    togglePinMemory: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.AI_TOGGLE_PIN_MEMORY, id),
    updateMemoryContent: (id: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.AI_UPDATE_MEMORY_CONTENT, id, content),
    batchSaveMemories: (items: CreateMemoryPayload[], context: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.AI_BATCH_SAVE_MEMORIES, items, context),
    pruneMemories: (context: string, limit: number): Promise<void> =>
      ipcRenderer.invoke('ai:pruneMemories', context, limit),
    auditMemories: (context: string, model: string): Promise<AiMemory[]> =>
      ipcRenderer.invoke('ai:auditMemories', context, model),
    consolidateMemory: (params: {
      context: string
      userText: string
      assistantText: string
      model: string
    }): Promise<AiMemory[]> => ipcRenderer.invoke(IpcChannels.AI_CONSOLIDATE_MEMORY, params)
  },
  workspace: {
    selectFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.WORKSPACE_SELECT_FOLDER),
    getStructure: (folderPath: string): Promise<WorkspaceFileInfo[]> =>
      ipcRenderer.invoke(IpcChannels.WORKSPACE_GET_STRUCTURE, folderPath),
    readFile: (folderPath: string, relativePath: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.WORKSPACE_READ_FILE, folderPath, relativePath)
  },
  media: {
    saveFromBuffer: (arrayBuffer: ArrayBuffer, extension: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.MEDIA_SAVE_FROM_BUFFER, arrayBuffer, extension),
    saveFilePaths: (filePaths: string[]): Promise<Array<{ originalPath: string; filename: string }>> =>
      ipcRenderer.invoke(IpcChannels.MEDIA_SAVE_FILE_PATHS, filePaths),
    scanAndPrune: (): Promise<{
      scannedCount: number
      prunedCount: number
      spaceSavedBytes: number
      prunedFiles: string[]
    }> => ipcRenderer.invoke(IpcChannels.MEDIA_SCAN_AND_PRUNE),
    getStorageInfo: (): Promise<{ fileCount: number; totalSize: number; path: string }> =>
      ipcRenderer.invoke(IpcChannels.MEDIA_GET_STORAGE_INFO)
  },
  sync: {
    startHost: (port?: number): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.SYNC_START_HOST, port),
    stopHost: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.SYNC_STOP_HOST),
    connectAndSync: (hostIp: string, port: number, pairingCode: string): Promise<{ dbUpdates: number; filesSynced: number }> =>
      ipcRenderer.invoke(IpcChannels.SYNC_CONNECT_AND_SYNC, hostIp, port, pairingCode),
    getStatus: (): Promise<{
      active: boolean
      port: number
      pairingCode: string
      progress: string
      isSyncing: boolean
    }> => ipcRenderer.invoke(IpcChannels.SYNC_GET_STATUS),
    getDiscoveredPeers: (): Promise<Array<{ name: string; ip: string; port: number; lastSeen: number }>> =>
      ipcRenderer.invoke(IpcChannels.SYNC_GET_DISCOVERED_PEERS),
    getDbPayload: (): Promise<SyncPayload> =>
      ipcRenderer.invoke(IpcChannels.SYNC_GET_DB_PAYLOAD),
    applyDbPayload: (payload: SyncPayload): Promise<{ pulledNewerCount: number }> =>
      ipcRenderer.invoke(IpcChannels.SYNC_APPLY_DB_PAYLOAD, payload),
    getFileIndex: (subDir: 'notes' | 'media'): Promise<SyncFileEntry[]> =>
      ipcRenderer.invoke(IpcChannels.SYNC_GET_FILE_INDEX, subDir),
    readFileChunk: (subDir: 'notes' | 'media', relPath: string): Promise<Uint8Array | null> =>
      ipcRenderer.invoke(IpcChannels.SYNC_READ_FILE_CHUNK, subDir, relPath),
    writeFileChunk: (subDir: 'notes' | 'media', relPath: string, buffer: ArrayBuffer, mtime?: number): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.SYNC_WRITE_FILE_CHUNK, subDir, relPath, buffer, mtime),
    deleteFile: (subDir: 'notes' | 'media', relPath: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.SYNC_DELETE_FILE, subDir, relPath),
    applyBoardBaseline: (
      context: string,
      items: Item[],
      tags: Tag[],
      itemTags: { item_id: string; tag_id: string }[],
      relations: Relation[]
    ): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.SYNC_APPLY_BOARD_BASELINE, context, items, tags, itemTags, relations),
    applyRemoteMutation: (mutation: any): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.SYNC_APPLY_REMOTE_MUTATION, mutation)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

/**
 * The renderer's view of the bridge is derived from the bridge itself, so the
 * two can never disagree. Adding a method here is all it takes for the
 * renderer to see it, there is no second declaration to keep in sync.
 */
export type ElectronAPI = typeof api
