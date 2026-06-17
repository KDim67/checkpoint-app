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
  HardwareSpecs,
  PullProgressEvent,
  TaskQueryParams,
  OllamaStatus
} from '../../shared/types'

export interface ElectronAPI {
  app: {
    platform: string
    getVersion: () => Promise<string>
    getDataPath: () => Promise<string>
    openExternal: (url: string) => Promise<void>
    minimize: () => void
    maximize: () => void
    close: () => void
    saveFile: (defaultName: string, content: string) => Promise<boolean>
  }
  db: {
    getItems: (context: string, type: string, page: number, pageSize: number) => Promise<PaginatedResult<Item>>
    createItem: (payload: CreateItemPayload, tagIds?: string[]) => Promise<Item>
    updateItem: (id: string, patch: Partial<Item>, tagIds?: string[]) => Promise<Item>
    deleteItem: (id: string) => Promise<void>
    getTags: () => Promise<Tag[]>
    createTag: (payload: CreateTagPayload) => Promise<Tag>
    updateTag: (id: string, payload: Partial<CreateTagPayload>) => Promise<Tag>
    deleteTag: (id: string) => Promise<void>
    getSetting: (key: string) => Promise<unknown>
    setSetting: (key: string, value: unknown) => Promise<void>
    getRelations: (itemId: string) => Promise<Relation[]>
    createRelation: (fromId: string, toId: string, type: RelationType) => Promise<Relation>
    deleteRelation: (id: string) => Promise<void>
    searchItems: (query: SearchQuery) => Promise<PaginatedResult<Item>>
    getContexts: () => Promise<string[]>
    bulkUpdateItems: (payload: BulkUpdatePayload) => Promise<{ updated: number }>
    bulkDeleteItems: (ids: string[]) => Promise<{ deleted: number }>
    rebalancePositions: (context: string, status: string) => Promise<void>
    queryTasks: (context: string, params: TaskQueryParams) => Promise<PaginatedResult<Item>>
  }
  ai: {
    startStream: (params: AiStreamParams) => Promise<void>
    abortStream: () => Promise<void>
    onChunk: (callback: (chunk: string) => void) => () => void
    onDone: (callback: () => void) => () => void
    onError: (callback: (errMessage: string) => void) => () => void
  }
  widget: {
    toggle: () => Promise<void>
    setPosition: (pos: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => Promise<void>
    setOpacity: (opacity: number) => Promise<void>
  }
  onThemeUpdate: (callback: (css: string) => void) => () => void
  hud: {
    toggle: () => Promise<void>
    onToggle: (callback: (visible: boolean) => void) => () => void
  }
  webhook: {
    toggle: (active: boolean, port: number) => Promise<void>
    onEvent: (callback: (payload: unknown) => void) => () => void
  }
  backup: {
    run: () => Promise<void>
  }
  tracker: {
    toggle: (active: boolean) => Promise<void>
    getState: () => Promise<boolean>
  }
  hardware: {
    getSpecs: () => Promise<HardwareSpecs>
  }
  ollama: {
    check: () => Promise<unknown>
    listLocal: () => Promise<string[]>
    pull: (modelTag: string, modelId: string) => Promise<void>
    stop: () => Promise<void>
    delete: (modelTag: string) => Promise<void>
    onPullProgress: (callback: (event: PullProgressEvent) => void) => () => void
    onPullDone: (callback: (modelId: string) => void) => () => void
    onPullError: (callback: (modelId: string, error: string) => void) => () => void
  }
  cookbook: {
    getHardwareSpecs: () => Promise<HardwareSpecs>
    checkOllama: () => Promise<OllamaStatus>
    pullModel: (modelTag: string) => Promise<void>
    stopPull: () => Promise<void>
    listLocalModels: () => Promise<string[]>
    onPullProgress: (callback: (event: PullProgressEvent) => void) => () => void
    onPullDone: (callback: (data: { modelTag: string }) => void) => () => void
    onPullError: (callback: (data: { modelTag: string; message: string }) => void) => () => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }

  interface ImportMeta {
    readonly env: {
      readonly DEV: boolean
      readonly PROD: boolean
      readonly MODE: string
      readonly [key: string]: string | boolean | undefined
    }
  }
}

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag' | 'inherit'
  }
}

