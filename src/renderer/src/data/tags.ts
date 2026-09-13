/** one place for tag lookups; the lookup-or-create loop was written four times with different colours */

import type { Tag } from '../../../shared/types'

/** what to match on, and what to paint a new one */
export interface TagWanted {
  name: string
  color: string
}

export async function listTags(): Promise<Tag[]> {
  return window.electronAPI.db.getTags()
}

export async function createTag(name: string, color: string): Promise<Tag> {
  return window.electronAPI.db.createTag({ name, color })
}

/** returns the updated list */
export async function recolourTag(id: string, color: string): Promise<Tag[]> {
  await window.electronAPI.db.updateTag(id, { color })
  return listTags()
}

/** deletes everywhere, returns the updated list */
export async function deleteTag(id: string): Promise<Tag[]> {
  await window.electronAPI.db.deleteTag(id)
  return listTags()
}

/** reads the list once per run; matches case-insensitively, creates as given, skips tags it can't make */
export async function tagResolver(): Promise<(wanted: TagWanted[]) => Promise<Tag[]>> {
  const known = await listTags().catch(() => [] as Tag[])

  return async (wanted: TagWanted[]): Promise<Tag[]> => {
    if (!Array.isArray(wanted) || wanted.length === 0) return []
    const resolved: Tag[] = []
    for (const { name, color } of wanted) {
      if (!name) continue
      const existing = known.find(tag => tag.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        resolved.push(existing)
        continue
      }
      try {
        const created = await createTag(name, color)
        known.push(created)
        resolved.push(created)
      } catch (err) {
        console.warn('Failed to create tag:', err)
      }
    }
    return resolved
  }
}

/** ids only */
export async function resolveTagIds(wanted: TagWanted[]): Promise<string[]> {
  if (wanted.length === 0) return []
  return (await (await tagResolver())(wanted)).map(tag => tag.id)
}
