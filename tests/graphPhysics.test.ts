import { describe, expect, it } from 'vitest'
import {
  ALPHA_DRAG, ALPHA_MIN, CONVERGENCE_KE, cool, EXACT_UP_TO, graphShape, repelApproximately, repelExactly, stepSimulation,
  type GraphLink, type GraphNode
} from '../src/renderer/src/components/notes/graphPhysics'

// the notes graph settles in a few seconds however big the vault, and looks as it did for a small one

/** nodes scattered the same way every run, no randomness */
const scatter = (count: number, width = 800, height = 600): GraphNode[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    x: 20 + ((i * 7919) % (width - 40)),
    y: 20 + ((i * 104729) % (height - 40)),
    vx: 0, vy: 0, fx: null, fy: null, missing: false, degree: 0
  }))

const chain = (nodes: GraphNode[]): GraphLink[] =>
  nodes.slice(1).map((n, i) => ({ source: nodes[i].id, target: n.id, sourceNode: nodes[i], targetNode: n }))

/** the step as it was, at full strength and every pair worked out */
function oldStep(nodes: GraphNode[], links: GraphLink[], width: number, height: number): number {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const distSq = dx * dx + dy * dy
      const dist = Math.sqrt(distSq) || 0.1
      const force = 180 / (distSq + 10)
      a.vx -= (dx / dist) * force; a.vy -= (dy / dist) * force
      b.vx += (dx / dist) * force; b.vy += (dy / dist) * force
    }
  }
  for (const link of links) {
    const a = link.sourceNode as GraphNode, b = link.targetNode as GraphNode
    const dx = b.x - a.x, dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
    const force = 0.05 * (dist - 65)
    a.vx += (dx / dist) * force; a.vy += (dy / dist) * force
    b.vx -= (dx / dist) * force; b.vy -= (dy / dist) * force
  }
  let ke = 0
  for (const n of nodes) {
    n.vx += (width / 2 - n.x) * 0.012; n.vy += (height / 2 - n.y) * 0.012
    n.x += n.vx; n.y += n.vy; n.vx *= 0.82; n.vy *= 0.82
    ke += n.vx * n.vx + n.vy * n.vy
    n.x = Math.max(12, Math.min(width - 12, n.x)); n.y = Math.max(12, Math.min(height - 12, n.y))
  }
  return ke
}

describe('a small graph', () => {
  it('moves exactly as it did at full heat', () => {
    const now = scatter(60), before = scatter(60)
    const linksNow = chain(now), linksBefore = chain(before)
    for (let s = 0; s < 5; s++) {
      expect(stepSimulation(now, linksNow, 800, 600, 1)).toBeCloseTo(oldStep(before, linksBefore, 800, 600), 9)
    }
    now.forEach((n, i) => {
      expect(n.x).toBeCloseTo(before[i].x, 9)
      expect(n.y).toBeCloseTo(before[i].y, 9)
    })
  })
})

describe('a big graph', () => {
  it('is pushed apart nearly as every pair would push it, at a fraction of the work', () => {
    const exact = scatter(1500), approx = scatter(1500)
    repelExactly(exact, 1)
    repelApproximately(approx, 1)
    const errors = exact.map((e, i) => {
      const a = approx[i]
      const size = Math.hypot(e.vx, e.vy) || 1e-9
      return Math.hypot(e.vx - a.vx, e.vy - a.vy) / size
    }).sort((x, y) => x - y)
    const median = errors[Math.floor(errors.length / 2)]
    expect(median).toBeLessThan(0.05)
  })

  it('settles within a few hundred steps however many notes there are', () => {
    const nodes = scatter(2000)
    const links = chain(nodes.slice(0, 600))
    let alpha = 1
    let steps = 0
    for (;;) {
      alpha = cool(alpha, false)
      const ke = stepSimulation(nodes, links, 800, 600, alpha)
      steps++
      if (ke < CONVERGENCE_KE || alpha < ALPHA_MIN) break
    }
    expect(steps).toBeLessThanOrEqual(310)
    expect(nodes.length).toBeGreaterThan(EXACT_UP_TO)
  })
})

describe('the heat', () => {
  it('fades to nothing on its own, and stays warm while a node is held', () => {
    let free = 1
    let held = 1
    for (let s = 0; s < 2000; s++) {
      free = cool(free, false)
      held = cool(held, true)
    }
    expect(free).toBeLessThan(ALPHA_MIN)
    expect(held).toBeCloseTo(ALPHA_DRAG, 3)
  })
})

describe("the graph's shape", () => {
  const notes = [{ title: 'Plans', links: ['Ideas'] }, { title: 'Ideas', links: [] }]

  it('is the same after a reload that changed no titles or links, as every save makes', () => {
    expect(graphShape(notes.map(n => ({ ...n, links: [...n.links] })))).toBe(graphShape(notes))
  })

  it('is the same when a save moves its note to the top of the list', () => {
    expect(graphShape([notes[1], notes[0]])).toBe(graphShape(notes))
  })

  it('changes with a new link, a rename or a new note', () => {
    const base = graphShape(notes)
    expect(graphShape([{ title: 'Plans', links: ['Ideas', 'Later'] }, notes[1]])).not.toBe(base)
    expect(graphShape([{ title: 'Plan', links: ['Ideas'] }, notes[1]])).not.toBe(base)
    expect(graphShape([...notes, { title: 'Later', links: [] }])).not.toBe(base)
  })
})
