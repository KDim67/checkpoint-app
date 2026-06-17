import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import type {
  Item,
  Tag,
  CreateItemPayload,
  CreateTagPayload,
  PaginatedResult,
  Relation,
  RelationType,
  AiStreamParams,
  BulkUpdatePayload,
  SearchQuery,
  TaskQueryParams,
  HardwareSpecs,
  OllamaStatus,
  PullProgressEvent
} from '../shared/types'

/**
 * Secure IPC bridge, exposes a typed API surface to the renderer.
 *
 * CRITICAL PATTERN: Every ipcRenderer.on() subscription MUST return an
 * explicit cleanup/unsubscribe function. React components call this in their
 * useEffect return to prevent zombie listeners and memory leaks after unmount.
 */

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  app: {
    platform: process.platform,
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
      ipcRenderer.invoke(IpcChannels.APP_SAVE_FILE, defaultName, content)
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
      return res.data
    },

    updateItem: async (
      id: string,
      patch: Partial<Item>,
      tagIds?: string[]
    ): Promise<Item> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_UPDATE_ITEM, id, patch, tagIds)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    deleteItem: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_DELETE_ITEM, id)
      if (!res.success) throw new Error(res.error)
    },

    getTags: async (): Promise<Tag[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_TAGS)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    createTag: async (payload: CreateTagPayload): Promise<Tag> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_CREATE_TAG, payload)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    updateTag: async (id: string, payload: Partial<CreateTagPayload>): Promise<Tag> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_UPDATE_TAG, id, payload)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    deleteTag: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_DELETE_TAG, id)
      if (!res.success) throw new Error(res.error)
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
      return res.data
    },

    deleteRelation: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_DELETE_RELATION, id)
      if (!res.success) throw new Error(res.error)
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
      return res.data
    },

    bulkDeleteItems: async (ids: string[]): Promise<{ deleted: number }> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_BULK_DELETE_ITEMS, ids)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    rebalancePositions: async (context: string, status: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_REBALANCE_POSITIONS, context, status)
      if (!res.success) throw new Error(res.error)
    },

    queryTasks: async (context: string, params: TaskQueryParams): Promise<PaginatedResult<Item>> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_QUERY_TASKS, context, params)
      if (!res.success) throw new Error(res.error)
      return res.data
    }
  },

  // AI Streaming
  ai: {
    startStream: (params: AiStreamParams): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.AI_STREAM_START, params),

    abortStream: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.AI_STREAM_ABORT),

    // Returns an unsubscribe function, MUST be called on component unmount
    onChunk: (callback: (chunk: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, chunk: string) => callback(chunk)
      ipcRenderer.on(IpcChannels.AI_CHUNK, handler)
      return () => ipcRenderer.removeListener(IpcChannels.AI_CHUNK, handler)
    },

    onDone: (callback: () => void): (() => void) => {
      const handler = () => callback()
      ipcRenderer.on(IpcChannels.AI_DONE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.AI_DONE, handler)
    },

    onError: (callback: (errMessage: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, errMessage: string) => callback(errMessage)
      ipcRenderer.on(IpcChannels.AI_ERROR, handler)
      return () => ipcRenderer.removeListener(IpcChannels.AI_ERROR, handler)
    }
  },

  // Widget
  widget: {
    toggle: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WIDGET_TOGGLE),
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
    toggle: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.HUD_TOGGLE),

    onToggle: (callback: (visible: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, visible: boolean) => callback(visible)
      ipcRenderer.on(IpcChannels.HUD_ON_TOGGLE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.HUD_ON_TOGGLE, handler)
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

  // Backup
  backup: {
    run: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.BACKUP_RUN)
  },

  // Activity Tracker
  tracker: {
    toggle: (active: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.TRACKER_TOGGLE, active),
    getState: (): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.TRACKER_GET_STATE)
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
  }
})
