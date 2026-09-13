/** tags on stickies: putting them on, taking them off, and gathering the stickies that share one */

import { boundsOf, cleanTags, createWallItem, MAX_TAGS, type WallItem } from './wallModel'

/** a locked sticky keeps its tags like its words */
export const taggable = (item: WallItem): boolean => item.kind === 'note' && !item.locked

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** every tag on the picked stickies, once each, in the order first met */
export function tagsOn(items: WallItem[], ids: Set<string>): string[] {
  const out: string[] = []
  for (const tag of items.filter(i => ids.has(i.id) && i.kind === 'note').flatMap(i => i.tags ?? [])) {
    if (!out.some(t => sameName(t, tag))) out.push(tag)
  }
  return out
}

/** onto every picked sticky that hasn't got it; the same array when none takes it */
export function addTag(items: WallItem[], ids: Set<string>, name: string): WallItem[] {
  const [clean] = cleanTags([name])
  if (!clean) return items
  let changed = false
  const next = items.map(item => {
    const tags = item.tags ?? []
    if (!ids.has(item.id) || !taggable(item) || tags.length >= MAX_TAGS || tags.some(t => sameName(t, clean))) return item
    changed = true
    return { ...item, tags: [...tags, clean] }
  })
  return changed ? next : items
}

/** off every picked sticky, in any case; the same array when none had it */
export function removeTag(items: WallItem[], ids: Set<string>, name: string): WallItem[] {
  let changed = false
  const next = items.map(item => {
    if (!ids.has(item.id) || !taggable(item) || !item.tags?.some(t => sameName(t, name))) return item
    changed = true
    const copy = { ...item, tags: item.tags.filter(t => !sameName(t, name)) }
    if (copy.tags.length === 0) delete copy.tags
    return copy
  })
  return changed ? next : items
}

/** the board's tag names that aren't on the stickies yet and match what's typed, the ones starting with it first */
export function tagSuggestions(known: string[], present: string[], query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase()
  const starts = (name: string): number => (name.toLowerCase().startsWith(q) ? 0 : 1)
  return known
    .filter(name => !present.some(p => sameName(p, name)) && name.toLowerCase().includes(q))
    .sort((a, b) => starts(a) - starts(b) || a.localeCompare(b))
    .slice(0, limit)
}

const GAP = 24
const FRAME_PAD = 40
const CLUSTER_GAP = 80

/** tagged stickies into a grid a tag, each in a frame named for it, left to right by name from where they started; a sticky goes by its first tag, an empty pick means the whole wall */
export function gatherByTag(
  items: WallItem[],
  ids: Set<string>,
  newId?: () => string
): { items: WallItem[]; clusters: number } {
  const picked = items.filter(i => taggable(i) && (i.tags?.length ?? 0) > 0 && (ids.size === 0 || ids.has(i.id)))
  const bounds = boundsOf(picked)
  if (!bounds) return { items, clusters: 0 }

  const clusters = new Map<string, { name: string; members: WallItem[] }>()
  for (const item of [...picked].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const name = (item.tags as string[])[0]
    const cluster = clusters.get(name.toLowerCase()) ?? { name, members: [] }
    cluster.members.push(item)
    clusters.set(name.toLowerCase(), cluster)
  }

  const moved = new Map<string, WallItem>()
  const added: WallItem[] = []
  const reused = new Set<string>()
  let left = bounds.minX
  const top = bounds.minY

  for (const { name, members } of [...clusters.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const columns = Math.ceil(Math.sqrt(members.length))
    const rows = Math.ceil(members.length / columns)
    const cellWidth = Math.max(...members.map(m => m.width))
    const cellHeight = Math.max(...members.map(m => m.height))
    const width = columns * cellWidth + (columns - 1) * GAP + FRAME_PAD * 2
    const height = rows * cellHeight + (rows - 1) * GAP + FRAME_PAD * 2

    members.forEach((member, n) => moved.set(member.id, {
      ...member,
      x: left + FRAME_PAD + (n % columns) * (cellWidth + GAP),
      y: top + FRAME_PAD + Math.floor(n / columns) * (cellHeight + GAP)
    }))

    const behind = Math.min(...members.map(m => m.z)) - 1
    // gathering again moves the frame it made last time instead of stacking another
    const frame = items.find(i => i.kind === 'frame' && !i.locked && !reused.has(i.id) && sameName((i.text ?? '').trim(), name))
    if (frame) {
      reused.add(frame.id)
      moved.set(frame.id, { ...frame, x: left, y: top, width, height, z: Math.min(frame.z, behind) })
    } else {
      const made = createWallItem('frame', { x: left + width / 2, y: top + height / 2 }, items, { width, height, text: name, z: behind })
      added.push(newId ? { ...made, id: newId() } : made)
    }
    left += width + CLUSTER_GAP
  }

  return { items: [...items.map(i => moved.get(i.id) ?? i), ...added], clusters: clusters.size }
}
