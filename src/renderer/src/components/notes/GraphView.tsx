import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { NoteMetadata } from '../../../../shared/types'

interface GraphNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
}

interface GraphLink {
  source: string
  target: string
  sourceNode?: GraphNode
  targetNode?: GraphNode
}

interface GraphViewProps {
  notes: NoteMetadata[]
  activeTitle: string | null
  onSelectNote: (title: string) => void
}

// Physics constants (shared by every simulation step)
const REPULSION = 180
const SPRING = 0.05
const REST_LENGTH = 65
const GRAVITY = 0.012
const FRICTION = 0.82
const CONVERGENCE_KE = 0.01
const DRAG_THRESHOLD = 3 // px of movement before a press counts as a drag (not a click)

/** Advances the simulation by one step (mutates nodes) and returns total kinetic energy. */
function stepSimulation(nodes: GraphNode[], links: GraphLink[], width: number, height: number): number {
  const centerX = width / 2
  const centerY = height / 2

  // Node repulsion (Coulomb)
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distSq = dx * dx + dy * dy
      const dist = Math.sqrt(distSq) || 0.1
      const force = REPULSION / (distSq + 10)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx -= fx; a.vy -= fy
      b.vx += fx; b.vy += fy
    }
  }

  // Spring attraction along links (Hooke)
  for (const link of links) {
    if (!link.sourceNode || !link.targetNode) continue
    const a = link.sourceNode
    const b = link.targetNode
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
    const force = SPRING * (dist - REST_LENGTH)
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    a.vx += fx; a.vy += fy
    b.vx -= fx; b.vy -= fy
  }

  // Center gravity
  for (const n of nodes) {
    n.vx += (centerX - n.x) * GRAVITY
    n.vy += (centerY - n.y) * GRAVITY
  }

  // Integrate + bound, and accumulate kinetic energy of free nodes
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

export default function GraphView({ notes, activeTitle, onSelectNote }: GraphViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dimensions, setDimensions] = useState({ width: 300, height: 300 })

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])

  const nodesRef = useRef<GraphNode[]>([])
  const linksRef = useRef<GraphLink[]>([])
  const dimsRef = useRef(dimensions)
  dimsRef.current = dimensions

  const nodeElementsRef = useRef<Record<string, SVGGElement | null>>({})
  const linkElementsRef = useRef<Record<number, SVGLineElement | null>>({})

  const rafRef = useRef<number | null>(null)
  const dragNodeIdRef = useRef<string | null>(null)

  // Single reusable animation loop; restart via ensureRunning().
  const ensureRunning = useCallback(() => {
    if (rafRef.current !== null) return
    const tick = (): void => {
      const { width, height } = dimsRef.current
      const totalKE = stepSimulation(nodesRef.current, linksRef.current, width, height)

      // Paint positions imperatively for performance
      for (const n of nodesRef.current) {
        const el = nodeElementsRef.current[n.id]
        if (el) el.setAttribute('transform', `translate(${n.x}, ${n.y})`)
      }
      linksRef.current.forEach((link, idx) => {
        const el = linkElementsRef.current[idx]
        if (el && link.sourceNode && link.targetNode) {
          el.setAttribute('x1', String(link.sourceNode.x))
          el.setAttribute('y1', String(link.sourceNode.y))
          el.setAttribute('x2', String(link.targetNode.x))
          el.setAttribute('y2', String(link.targetNode.y))
        }
      })

      // Keep looping while dragging or until the graph settles
      if (totalKE < CONVERGENCE_KE && dragNodeIdRef.current === null) {
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // 1. Monitor container size
  useEffect(() => {
    if (!containerRef.current) return
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({
          width: Math.max(100, entry.contentRect.width),
          height: Math.max(100, entry.contentRect.height)
        })
      }
    })
    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  // 2. Rebuild nodes/links when notes change, preserving existing positions,
  //    then reheat the simulation so new nodes settle into place.
  useEffect(() => {
    const existing = new Map<string, GraphNode>()
    nodesRef.current.forEach(n => existing.set(n.id, n))

    const { width, height } = dimsRef.current
    const centerX = width / 2
    const centerY = height / 2

    const newNodes: GraphNode[] = notes.map((note, i) => {
      const prev = existing.get(note.title)
      if (prev) return prev
      // Spawn brand-new nodes on a ring around the center (deterministic: no RNG)
      const angle = (i / Math.max(1, notes.length)) * Math.PI * 2
      const radius = 25 + (i % 4) * 12
      return {
        id: note.title,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        vx: 0, vy: 0, fx: null, fy: null
      }
    })

    // Case-insensitive edge resolution against real note titles
    const canonical = new Map<string, string>()
    notes.forEach(n => canonical.set(n.title.toLowerCase(), n.title))

    const newLinks: GraphLink[] = []
    const seen = new Set<string>()
    notes.forEach(note => {
      note.links.forEach(target => {
        const realTarget = canonical.get(target.toLowerCase())
        if (!realTarget || realTarget === note.title) return
        const [first, second] = [note.title, realTarget].sort()
        // NUL separates the pair so a title containing the separator cannot forge
        // a collision with a different pair. Written as an escape, not a raw
        // byte: a literal NUL makes this file binary to every text tool.
        const key = `${first}\u0000${second}`
        if (seen.has(key)) return
        seen.add(key)
        newLinks.push({ source: first, target: second })
      })
    })

    const nodeById = new Map(newNodes.map(n => [n.id, n]))
    newLinks.forEach(link => {
      link.sourceNode = nodeById.get(link.source)
      link.targetNode = nodeById.get(link.target)
    })

    nodesRef.current = newNodes
    linksRef.current = newLinks
    setNodes(newNodes)
    setLinks(newLinks)

    // Give free nodes a small kick so the layout reflows after add/remove
    newNodes.forEach(n => {
      if (n.fx === null) { n.vx += (Math.cos(n.x) * 0.5); n.vy += (Math.sin(n.y) * 0.5) }
    })
    ensureRunning()
  }, [notes, ensureRunning])

  // 3. Reheat on resize and on mount; always stop the loop on unmount.
  useEffect(() => {
    ensureRunning()
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [dimensions, ensureRunning])

  // 4. Drag + click handling
  const handleMouseDown = (e: React.MouseEvent, nodeId: string): void => {
    e.preventDefault()
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    let moved = false

    dragNodeIdRef.current = nodeId
    const node = nodesRef.current.find(n => n.id === nodeId)
    if (node) {
      node.fx = e.clientX - rect.left
      node.fy = e.clientY - rect.top
    }
    ensureRunning()

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      if (!dragNodeIdRef.current) return
      if (Math.abs(moveEvent.clientX - startX) > DRAG_THRESHOLD || Math.abs(moveEvent.clientY - startY) > DRAG_THRESHOLD) {
        moved = true
      }
      const target = nodesRef.current.find(n => n.id === dragNodeIdRef.current)
      if (target) {
        target.fx = moveEvent.clientX - rect.left
        target.fy = moveEvent.clientY - rect.top
      }
    }

    const handleMouseUp = (): void => {
      const id = dragNodeIdRef.current
      if (id) {
        const target = nodesRef.current.find(n => n.id === id)
        if (target) { target.fx = null; target.fy = null }
      }
      dragNodeIdRef.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      // A press with no meaningful movement is a click → open the note
      if (!moved && id) onSelectNote(id)
      ensureRunning()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: '200px',
        background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-surface-offset)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {nodes.length === 0 ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)', padding: 'var(--space-4)' }}>
          Link notes with [[Wiki Links]] to see them connect here.
        </div>
      ) : (
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          style={{ display: 'block', pointerEvents: 'auto' }}
        >
          <g>
            {links.map((link, idx) => (
              <line
                key={`${link.source}-${link.target}-${idx}`}
                ref={el => { linkElementsRef.current[idx] = el }}
                stroke="var(--color-surface-offset)"
                strokeWidth="1.5"
                style={{ opacity: 0.7 }}
              />
            ))}
          </g>
          <g>
            {nodes.map(node => {
              const isActive = node.id === activeTitle
              return (
                <g
                  key={node.id}
                  ref={el => {
                    nodeElementsRef.current[node.id] = el
                    // Seed the initial transform once so new nodes don't flash at origin
                    if (el && !el.getAttribute('transform')) {
                      el.setAttribute('transform', `translate(${node.x}, ${node.y})`)
                    }
                  }}
                  onMouseDown={e => handleMouseDown(e, node.id)}
                  style={{ cursor: dragNodeIdRef.current === node.id ? 'grabbing' : 'pointer' }}
                >
                  <circle
                    r={isActive ? 8 : 5}
                    fill={isActive ? 'var(--color-secondary)' : 'var(--color-primary)'}
                    stroke="var(--color-surface-offset)"
                    strokeWidth="1.5"
                    style={{
                      filter: isActive ? 'drop-shadow(0 0 4px var(--color-secondary))' : 'none',
                      transition: 'fill 0.2s, r 0.2s'
                    }}
                  />
                  <text
                    dy="16"
                    textAnchor="middle"
                    fill={isActive ? 'var(--color-text-base)' : 'var(--color-text-muted)'}
                    style={{
                      fontSize: '10px',
                      fontFamily: 'var(--font-sans)',
                      fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                      userSelect: 'none',
                      pointerEvents: 'none'
                    }}
                  >
                    {node.id}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      )}
    </div>
  )
}
