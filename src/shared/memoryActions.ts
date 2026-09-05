/**
 * What the model is allowed to have said about the memory store.
 *
 * The AI is asked to return a JSON array of save, update and delete actions,
 * and those actions write and delete rows. Whatever comes back is a model's
 * guess at a shape, not the shape, so it is normalised before anything acts on
 * it: entries that are not objects, actions nobody recognises, a delete with
 * no key, a save with nothing to save. All dropped rather than half-applied.
 *
 * Hand-written rather than a schema library, matching boardModel and
 * wallModel. Zod stays out of the renderer bundle on purpose.
 */

export type MemoryActionKind = 'save' | 'update' | 'delete'
export type MemoryCategory = 'semantic' | 'episodic' | 'working'

export interface MemoryAction {
  action: MemoryActionKind
  category?: MemoryCategory
  memory_key: string
  content?: string
}

const KINDS: MemoryActionKind[] = ['save', 'update', 'delete']
const CATEGORIES: MemoryCategory[] = ['semantic', 'episodic', 'working']

/** Long enough for anything meant, short enough not to be a payload. */
const MAX_KEY = 120
const MAX_CONTENT = 2000

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One action, or null when there is not enough of one to act on. */
export function normalizeMemoryAction(raw: unknown): MemoryAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  const action = str(o.action).trim().toLowerCase() as MemoryActionKind
  if (!KINDS.includes(action)) return null

  const memory_key = str(o.memory_key).trim().toLowerCase().slice(0, MAX_KEY)
  if (!memory_key) return null

  const content = str(o.content).slice(0, MAX_CONTENT)
  // Saving or updating nothing would blank a memory rather than change it.
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

/** Every action worth acting on, in the order the model gave them. */
export function normalizeMemoryActions(raw: unknown): MemoryAction[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(normalizeMemoryAction)
    .filter((a): a is MemoryAction => a !== null)
}
