/** the notes graph's layout: pushes apart, pulls along links, settles; kept free of React so it can be measured on its own */

export interface GraphNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
  /** linked to, but no such note */
  missing: boolean
  /** link count, drives size */
  degree: number
}

export interface GraphLink {
  source: string
  target: string
  sourceNode?: GraphNode
  targetNode?: GraphNode
}

const REPULSION = 180
const SPRING = 0.05
const REST_LENGTH = 65
const GRAVITY = 0.012
const FRICTION = 0.82
export const CONVERGENCE_KE = 0.01

/** how hot the layout runs, fading to nothing so it always settles; at full heat the forces are as they always were */
export const ALPHA_MIN = 0.001
/** about 300 steps from full heat to settled, as d3-force does; a big vault used to keep the window busy for half a minute */
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300)
/** kept this warm while a node is held, so the rest follow it */
export const ALPHA_DRAG = 0.3

export function cool(alpha: number, dragging: boolean): number {
  return alpha + ((dragging ? ALPHA_DRAG : 0) - alpha) * ALPHA_DECAY
}

/** up to this many every pair is worked out; past it, far groups push as one, which is what makes thousands of notes affordable */
export const EXACT_UP_TO = 400
/** how far a group must be, against its size, to push as one */
const THETA = 0.9
/** coincident nodes stop splitting here */
const MAX_DEPTH = 24

function push(a: GraphNode, dx: number, dy: number, mass: number, alpha: number): void {
  const distSq = dx * dx + dy * dy
  const dist = Math.sqrt(distSq) || 0.1
  const force = (mass * REPULSION * alpha) / (distSq + 10)
  a.vx -= (dx / dist) * force
  a.vy -= (dy / dist) * force
}

export function repelExactly(nodes: GraphNode[], alpha: number): void {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      push(a, dx, dy, 1, alpha)
      push(b, -dx, -dy, 1, alpha)
    }
  }
}

interface Quad {
  x0: number
  y0: number
  size: number
  mass: number
  cx: number
  cy: number
  /** a leaf's nodes, usually one */
  members: GraphNode[]
  kids: Quad[] | null
}

const quad = (x0: number, y0: number, size: number): Quad => ({ x0, y0, size, mass: 0, cx: 0, cy: 0, members: [], kids: null })

function insert(q: Quad, n: GraphNode, depth: number): void {
  q.cx = (q.cx * q.mass + n.x) / (q.mass + 1)
  q.cy = (q.cy * q.mass + n.y) / (q.mass + 1)
  q.mass++
  if (q.kids === null) {
    if (q.members.length === 0 || depth >= MAX_DEPTH) {
      q.members.push(n)
      return
    }
    const half = q.size / 2
    q.kids = [quad(q.x0, q.y0, half), quad(q.x0 + half, q.y0, half), quad(q.x0, q.y0 + half, half), quad(q.x0 + half, q.y0 + half, half)]
    const moving = q.members
    q.members = []
    for (const m of moving) insertBelow(q, m, depth)
  }
  insertBelow(q, n, depth)
}

function insertBelow(q: Quad, n: GraphNode, depth: number): void {
  const half = q.size / 2
  const k = (n.x >= q.x0 + half ? 1 : 0) + (n.y >= q.y0 + half ? 2 : 0)
  insert((q.kids as Quad[])[k], n, depth + 1)
}

function pushFromTree(a: GraphNode, q: Quad, alpha: number): void {
  if (q.mass === 0) return
  if (q.kids === null) {
    for (const b of q.members) if (b !== a) push(a, b.x - a.x, b.y - a.y, 1, alpha)
    return
  }
  const dx = q.cx - a.x
  const dy = q.cy - a.y
  const inside = a.x >= q.x0 && a.x < q.x0 + q.size && a.y >= q.y0 && a.y < q.y0 + q.size
  if (!inside && q.size * q.size < THETA * THETA * (dx * dx + dy * dy)) {
    push(a, dx, dy, q.mass, alpha)
    return
  }
  for (const kid of q.kids) pushFromTree(a, kid, alpha)
}

/** Barnes and Hut's way: a quadtree of the nodes, and a far group pushes as one body at its centre */
export function repelApproximately(nodes: GraphNode[], alpha: number): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x > maxX) maxX = n.x
    if (n.y > maxY) maxY = n.y
  }
  // a hair over the spread, so the farthest node falls inside the root
  const root = quad(minX, minY, Math.max(maxX - minX, maxY - minY, 1) * 1.0001)
  for (const n of nodes) insert(root, n, 0)
  for (const n of nodes) pushFromTree(n, root, alpha)
}

/** one step at the given heat, mutates nodes, returns kinetic energy */
export function stepSimulation(nodes: GraphNode[], links: GraphLink[], width: number, height: number, alpha = 1): number {
  const centerX = width / 2
  const centerY = height / 2

  if (nodes.length <= EXACT_UP_TO) repelExactly(nodes, alpha)
  else repelApproximately(nodes, alpha)

  // springs along links (Hooke)
  for (const link of links) {
    if (!link.sourceNode || !link.targetNode) continue
    const a = link.sourceNode
    const b = link.targetNode
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
    const force = SPRING * alpha * (dist - REST_LENGTH)
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    a.vx += fx; a.vy += fy
    b.vx -= fx; b.vy -= fy
  }

  // centre gravity
  for (const n of nodes) {
    n.vx += (centerX - n.x) * GRAVITY * alpha
    n.vy += (centerY - n.y) * GRAVITY * alpha
  }

  // integrate, bound, sum KE of free nodes
  let totalKE = 0
  for (const n of nodes) {
    if (n.fx !== null && n.fy !== null) {
      n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0
    } else {
      n.x += n.vx; n.y += n.vy
      n.vx *= FRICTION; n.vy *= FRICTION
      totalKE += n.vx * n.vx + n.vy * n.vy
    }
    n.x = Math.max(12, Math.min(width - 12, n.x))
    n.y = Math.max(12, Math.min(height - 12, n.y))
  }
  return totalKE
}

/** what the graph is drawn from: titles and their links; a reload that leaves these alone needn't stir the layout */
export function graphShape(notes: { title: string; links: string[] }[]): string {
  // in title order: a save moves its note to the top of the list without changing the graph
  return notes.map(n => `${n.title}\u0001${n.links.join('\u0002')}`).sort().join('\u0000')
}
