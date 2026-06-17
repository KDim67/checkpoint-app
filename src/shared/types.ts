/**
 * All shared domain types for Checkpoint.
 * This file is imported by BOTH the main process and the renderer.
 * Do NOT use Node.js-specific types (Buffer, NodeJS.*) here.
 */

// Core Domain Types

export type ItemType = 'log' | 'card' | 'task'
export type ItemStatus = string
export type ItemPriority = 0 | 1 | 2 | 3 // 0=none, 1=low, 2=med, 3=high
export type RelationType = 'blocks' | 'relates_to' | 'duplicates'

export interface Item {
  id: string             // UUID v4
  type: ItemType
  context: string        // e.g. 'dayjob' | 'unity-project' | 'personal'
  title: string
  body: string           // Markdown content
  status: ItemStatus
  priority: ItemPriority
  position: number       // fractional index for drag-and-drop ordering
  created_at: number     // Unix timestamp ms
  updated_at: number     // Unix timestamp ms
  due_at: number | null  // nullable Unix timestamp ms
  metadata: string       // JSON string for type-specific extensions
  tags?: Tag[]           // populated by join queries
}

export type CreateItemPayload = Omit<Item, 'id' | 'created_at' | 'updated_at' | 'tags'>

export interface Tag {
  id: string
  name: string
  color: string          // hex color, e.g. '#535e85'
}

export type CreateTagPayload = Omit<Tag, 'id'>

export interface Relation {
  id: string
  from_id: string
  to_id: string
  type: RelationType
}

export interface AppSetting {
  key: string
  value: string          // JSON-stringified value
}

export interface Context {
  slug: string           // e.g. 'unity-project'
  name: string           // e.g. 'Unity Project'
  color: string          // hex
  icon?: string          // emoji or icon name
}

export interface ActivityLog {
  id: string
  context: string
  window_title: string
  process_name: string
  duration_ms: number
  captured_at: number
}

// Pagination

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// AI

export interface AiStreamParams {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
}

export interface AiSettings {
  baseURL: string        // e.g. 'http://localhost:11434/v1' for Ollama
  apiKey: string         // 'ollama' for local, real key for OpenAI
  model: string
}

// AI Cookbook / Hardware

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown'

export interface HardwareSpecs {
  ramGb: number
  cpuCores: number
  cpuThreads: number
  gpuVendor: GpuVendor
  gpuName: string
  vramGb: number
  platform: string       // 'win32' | 'darwin' | 'linux'
}

export type QuantizationLevel = 'q4' | 'q8' | 'f16'
export type FitStatus = 'optimal' | 'tight' | 'cpu_offload' | 'not_recommended'

export interface ModelVariant {
  quantization: QuantizationLevel
  ramRequiredGb: number
  vramRequiredGb: number
  fileSizeGb: number
  ollamaTag: string
}

export interface FitResult {
  status: FitStatus
  score: number          // 0–100
  reason: string
  recommendedVariant: QuantizationLevel
}

export interface CatalogModel {
  id: string
  name: string
  family: string
  parameters: number
  description: string
  useCases: string[]
  homepageUrl: string
  variants: Record<QuantizationLevel, ModelVariant>
}

export interface OllamaStatus {
  installed: boolean
  running: boolean
  downloadUrl: string
  localModels: string[]
}

export interface PullProgressEvent {
  modelId: string
  status: string
  completedBytes: number
  totalBytes: number
  percent: number        // 0–100, -1 if total unknown
}

// Bulk Operations

export interface BulkUpdatePayload {
  ids: string[]
  patch: Partial<Pick<Item, 'status' | 'priority' | 'context'>>
}

// Search

export interface SearchQuery {
  query: string
  context?: string
  type?: ItemType
  status?: ItemStatus
  page?: number
  pageSize?: number
}

export interface TaskQueryParams {
  query?: string
  status?: string[]
  priority?: number[]
  tagIds?: string[]
  dueStart?: number | null
  dueEnd?: number | null
  hasRelations?: boolean | null
  sortBy?: string
  sortDesc?: boolean
  page?: number
  pageSize?: number
}

