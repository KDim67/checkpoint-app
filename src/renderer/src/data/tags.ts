/**
 * Tags, as the rest of the renderer asks for them.
 *
 * The screens that show tags went to the bridge directly, which meant the
 * "look it up, create it if it is new" loop was written out four times with a
 * different colour rule in each, and every mutation was followed by its own
 * hand-written refetch.
 */

import type { Tag } from '../../../shared/types'

/** A tag to attach, as the caller knows it: what to match on, what to paint a new one. */
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

/** Recolours a tag and hands back the list as it now stands. */
export async function recolourTag(id: string, color: string): Promise<Tag[]> {
  await window.electronAPI.db.updateTag(id, { color })
  return listTags()
}

/** Deletes a tag everywhere and hands back the list as it now stands. */
export async function deleteTag(id: string): Promise<Tag[]> {
  await window.electronAPI.db.deleteTag(id)
  return listTags()
}

/**
 * A resolver that reads the tag list once and remembers what it creates.
 *
 * The batch paths resolve tags for every card in a run, so reloading the list
 * per card would be a round trip per card. Hold the resolver for the run.
 *
 * Matching is case-insensitive, because "Bug" and "bug" are the same label to
 * everyone but a database. Creation is not: the name is stored exactly as
 * given, since quick capture wants lowercase and the assistant wants what the
 * user typed.
 *
 * A tag that cannot be created is skipped rather than thrown, so one bad name
 * does not cost the caller the rest of its tags.
 */
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

/** One round of the above, for a caller that only wants the ids. */
export async function resolveTagIds(wanted: TagWanted[]): Promise<string[]> {
  if (wanted.length === 0) return []
  return (await (await tagResolver())(wanted)).map(tag => tag.id)
}
