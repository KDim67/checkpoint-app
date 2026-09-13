/** model output writes and deletes rows, so normalise first; hand-written to keep Zod out of the renderer */

type MemoryActionKind = 'save' | 'update' | 'delete'
export type MemoryCategory = 'semantic' | 'episodic' | 'working'

export interface MemoryAction {
  action: MemoryActionKind
  category?: MemoryCategory
  memory_key: string
  content?: string
}

const KINDS: MemoryActionKind[] = ['save', 'update', 'delete']
const CATEGORIES: MemoryCategory[] = ['semantic', 'episodic', 'working']

/** long enough for anything meant */
const MAX_KEY = 120
const MAX_CONTENT = 2000

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** null when there's not enough to act on */
export function normalizeMemoryAction(raw: unknown): MemoryAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  const action = str(o.action).trim().toLowerCase() as MemoryActionKind
  if (!KINDS.includes(action)) return null

  const memory_key = str(o.memory_key).trim().toLowerCase().slice(0, MAX_KEY)
  if (!memory_key) return null

  const content = str(o.content).slice(0, MAX_CONTENT)
  // empty content would blank a memory
  if ((action === 'save' || action === 'update') && !content.trim()) return null

  const rawCategory = str(o.category).trim().toLowerCase() as MemoryCategory
  const category = CATEGORIES.includes(rawCategory) ? rawCategory : undefined

  return {
    action,
    memory_key,
    ...(category ? { category } : {}),
    ...(content ? { content } : {})
  }
}

/** in the model's order */
export function normalizeMemoryActions(raw: unknown): MemoryAction[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(normalizeMemoryAction)
    .filter((a): a is MemoryAction => a !== null)
}
