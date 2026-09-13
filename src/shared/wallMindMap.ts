/** mind maps: topics joined by a line from each to the ones under it, laid out as a tree either side of the first */

import { createWallItem, WALL_COLORS, type WallItem } from './wallModel'

export const newMapId = (): string => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export const MAP_GAP_X = 72
export const MAP_GAP_Y = 16
const ROOT_SIZE = { width: 200, height: 72 }
const TOPIC_SIZE = { width: 180, height: 48 }
const ROOT_COLOR = WALL_COLORS[2]
/** the root's own colour left out, so a branch never looks like the centre */
const BRANCH_COLORS = WALL_COLORS.filter(c => c !== ROOT_COLOR)

export interface MapTree {
  /** a topic's id to the id of the topic it hangs from */
  parent: Map<string, string>
  /** a topic's id to the ids under it, top to bottom */
  children: Map<string, string[]>
  /** topics hanging from nothing, the first made first */
  roots: string[]
}

const centreX = (item: WallItem): number => item.x + item.width / 2
const centreY = (item: WallItem): number => item.y + item.height / 2

/** read from the lines between the map's topics; the oldest line into a topic is the one it hangs from, and one that would loop is ignored */
export function mapTree(items: WallItem[], mapId: string): MapTree {
  const topics = new Map(items.filter(i => i.map === mapId && i.kind !== 'arrow').map(i => [i.id, i]))
  const topic = (id: string): WallItem => topics.get(id) as WallItem
  const parent = new Map<string, string>()

  const lines = items
    .filter(i => i.kind === 'arrow' && !!i.from && !!i.to && topics.has(i.from) && topics.has(i.to))
    .sort((a, b) => a.z - b.z)
  for (const line of lines) {
    const from = line.from as string
    const to = line.to as string
    if (from === to || parent.has(to)) continue
    let up: string | undefined = from
    while (up && up !== to) up = parent.get(up)
    if (up !== to) parent.set(to, from)
  }

  const children = new Map<string, string[]>()
  for (const [child, of] of parent) children.set(of, [...(children.get(of) ?? []), child])
  for (const list of children.values()) list.sort((a, b) => centreY(topic(a)) - centreY(topic(b)) || topic(a).z - topic(b).z)

  const roots = [...topics.values()].filter(t => !parent.has(t.id)).sort((a, b) => a.z - b.z).map(t => t.id)
  return { parent, children, roots }
}

/** each root stays put; its branches stack to the right, or the left for ones dragged to that side, each centred on the topic it hangs from */
export function layoutMap(items: WallItem[], mapId: string): WallItem[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const box = (id: string): WallItem => byId.get(id) as WallItem
  const { children, roots } = mapTree(items, mapId)
  const kidsOf = (id: string): string[] => children.get(id) ?? []

  const bands = new Map<string, number>()
  /** the height a topic and everything under it take */
  const band = (id: string): number => {
    const known = bands.get(id)
    if (known !== undefined) return known
    const height = Math.max(box(id).height, stacked(kidsOf(id)))
    bands.set(id, height)
    return height
  }
  const stacked = (ids: string[]): number => ids.reduce((sum, id) => sum + band(id), 0) + MAP_GAP_Y * Math.max(0, ids.length - 1)

  const placed = new Map<string, { x: number; y: number }>()
  const stack = (ids: string[], parent: { x: number; y: number; width: number }, side: 'left' | 'right', middle: number): void => {
    let top = middle - stacked(ids) / 2
    for (const id of ids) {
      const item = box(id)
      const height = band(id)
      const at = {
        x: side === 'right' ? parent.x + parent.width + MAP_GAP_X : parent.x - MAP_GAP_X - item.width,
        y: top + height / 2 - item.height / 2
      }
      placed.set(id, at)
      stack(kidsOf(id), { ...at, width: item.width }, side, top + height / 2)
      top += height + MAP_GAP_Y
    }
  }

  for (const rootId of roots) {
    const root = box(rootId)
    const kids = kidsOf(rootId)
    const leftward = kids.filter(id => centreX(box(id)) < centreX(root))
    stack(kids.filter(id => !leftward.includes(id)), root, 'right', centreY(root))
    stack(leftward, root, 'left', centreY(root))
  }

  let changed = false
  const next = items.map(item => {
    const at = placed.get(item.id)
    if (!at || item.locked || (Math.abs(at.x - item.x) < 0.01 && Math.abs(at.y - item.y) < 0.01)) return item
    changed = true
    return { ...item, x: at.x, y: at.y }
  })
  return changed ? next : items
}

/** a new map's centre topic, centred on the point */
export function mapRoot(items: WallItem[], at: { x: number; y: number }, id: string = newMapId()): WallItem {
  return createWallItem('shape', at, items, { ...ROOT_SIZE, shape: 'rounded', color: ROOT_COLOR, map: id })
}

export type TopicPlace = 'child' | 'sibling'

/** a topic under this one, or beside it under the same parent, joined by a line and laid out; a root's sibling is its child; null when it isn't a topic */
export function addTopic(items: WallItem[], fromId: string, place: TopicPlace): { items: WallItem[]; topic: WallItem } | null {
  const from = items.find(i => i.id === fromId)
  if (!from?.map) return null
  const mapId = from.map
  const find = (id: string): WallItem => items.find(i => i.id === id) as WallItem
  const tree = mapTree(items, mapId)

  const parentId = place === 'child' ? from.id : tree.parent.get(from.id) ?? from.id
  const parent = find(parentId)
  const siblings = (tree.children.get(parentId) ?? []).map(find)
  let rootId = parentId
  while (tree.parent.has(rootId)) rootId = tree.parent.get(rootId) as string
  const root = find(rootId)
  const leftOfRoot = (item: WallItem): boolean => centreX(item) < centreX(root)

  // a new branch off the centre goes to the emptier side, anything further out stays on its branch's
  const onLeft = parentId === rootId
    ? place === 'sibling' && from.id !== parentId
      ? leftOfRoot(from)
      : siblings.filter(leftOfRoot).length * 2 < siblings.length
    : leftOfRoot(parent)
  // the tree sorts by middle, so a sibling lands just under its topic and a child under the last one
  const above = place === 'sibling' && from.id !== parentId ? from : siblings[siblings.length - 1]
  const middle = above ? centreY(above) + 0.5 : centreY(parent)
  const color = parentId === rootId ? BRANCH_COLORS[siblings.length % BRANCH_COLORS.length] : parent.color
  const x = onLeft ? parent.x - MAP_GAP_X - TOPIC_SIZE.width : parent.x + parent.width + MAP_GAP_X

  const topic = createWallItem('shape', { x: x + TOPIC_SIZE.width / 2, y: middle }, items, {
    ...TOPIC_SIZE, shape: 'rounded', map: mapId, ...(color ? { color } : {})
  })
  const line = createWallItem('arrow', { x: 0, y: 0 }, [...items, topic], {
    from: parent.id, to: topic.id, arrowHeads: 'none', strokeWidth: 2
  })
  const laid = layoutMap([...items, topic, line], mapId)
  return { items: laid, topic: laid.find(i => i.id === topic.id) as WallItem }
}

/** the picked items and every topic under a picked topic, so a branch goes as a whole */
export function withBranches(items: WallItem[], ids: Set<string>): Set<string> {
  const out = new Set(ids)
  const maps = new Set(items.filter(i => ids.has(i.id) && i.map).map(i => i.map as string))
  for (const mapId of maps) {
    const { children } = mapTree(items, mapId)
    const visit = (id: string): void => {
      for (const kid of children.get(id) ?? []) {
        out.add(kid)
        visit(kid)
      }
    }
    for (const id of ids) visit(id)
  }
  return out
}

/** every map a set of items touches, to lay out again after they change */
export const mapsOf = (items: WallItem[]): string[] => [...new Set(items.filter(i => i.map).map(i => i.map as string))]
