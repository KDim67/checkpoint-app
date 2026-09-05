import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { NoteMetadata } from '../../../../shared/types'

interface GraphNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
  /** Linked to by a note, but no note of that name exists. */
  missing: boolean
  /** How many links touch this node. Drives its size. */
  degree: number
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

const MIN_ZOOM = 0.4
const MAX_ZOOM = 4
/** Past this, there is room for every label without them piling up. */
const LABEL_ZOOM = 1.3
/** Below this many nodes, labels fit at any zoom. */
const LABEL_NODE_LIMIT = 12

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

/** Node radius from how well connected it is, so hubs read as hubs. */
function radiusFor(node: GraphNode, isActive: boolean): number {
  if (isActive) return 8
  return Math.min(7.5, 4 + Math.sqrt(node.degree) * 1.1)
}

export default function GraphView({ notes, activeTitle, onSelectNote }: GraphViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dimensions, setDimensions] = useState({ width: 300, height: 300 })

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])

  /** Pan and zoom. Purely a view transform: the physics never sees it. */
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 })
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  const [hoverId, setHoverId] = useState<string | null>(null)
  /** In state, not a ref. A ref read during render never re-renders, which is
   *  why the grab cursor used to never appear. */
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const nodesRef = useRef<GraphNode[]>([])
  const linksRef = useRef<GraphLink[]>([])
  const dimsRef = useRef(dimensions)
  dimsRef.current = dimensions

  const nodeElementsRef = useRef<Record<string, SVGGElement | null>>({})
  const linkElementsRef = useRef<Record<number, SVGLineElement | null>>({})

  const rafRef = useRef<number | null>(null)
  const dragNodeIdRef = useRef<string | null>(null)

  /** Everything one hop from the hovered node, itself included. */
  const focus = useMemo(() => {
    if (!hoverId) return null
    const near = new Set<string>([hoverId])
    for (const l of links) {
      if (l.source === hoverId) near.add(l.target)
      else if (l.target === hoverId) near.add(l.source)
    }
    return near
  }, [hoverId, links])

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

    // Case-insensitive edge resolution against real note titles
    const canonical = new Map<string, string>()
    notes.forEach(n => canonical.set(n.title.toLowerCase(), n.title))

    // A link whose target does not exist still says something: it is usually a
    // typo, or a note somebody meant to write. Dropping it silently was the
    // graph disagreeing with the editor, which shows the same link as broken.
    const missing = new Map<string, string>()
    notes.forEach(note => {
      note.links.forEach(target => {
        const key = target.trim().toLowerCase()
        if (!key || canonical.has(key) || missing.has(key)) return
        missing.set(key, target.trim())
      })
    })

    const spawn = (id: string, i: number, total: number, isMissing: boolean): GraphNode => {
      const prev = existing.get(id)
      if (prev) return { ...prev, missing: isMissing, degree: 0 }
      // Spawn brand-new nodes on a ring around the center (deterministic: no RNG)
      const angle = (i / Math.max(1, total)) * Math.PI * 2
      const radius = 25 + (i % 4) * 12
      return {
        id,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        vx: 0, vy: 0, fx: null, fy: null,
        missing: isMissing,
        degree: 0
      }
    }

    const total = notes.length + missing.size
    const newNodes: GraphNode[] = [
      ...notes.map((note, i) => spawn(note.title, i, total, false)),
      ...[...missing.values()].map((title, i) => spawn(title, notes.length + i, total, true))
    ]

    // Missing targets resolve to themselves so their edges still connect.
    const resolve = new Map(canonical)
    missing.forEach((title, key) => resolve.set(key, title))

    const newLinks: GraphLink[] = []
    const seen = new Set<string>()
    notes.forEach(note => {
      note.links.forEach(target => {
        const realTarget = resolve.get(target.trim().toLowerCase())
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
      if (link.sourceNode) link.sourceNode.degree++
      if (link.targetNode) link.targetNode.degree++
    })

    // Keys for nodes and links that no longer exist would otherwise pile up for
    // the life of the session.
    const liveIds = new Set(newNodes.map(n => n.id))
    for (const id of Object.keys(nodeElementsRef.current)) {
      if (!liveIds.has(id)) delete nodeElementsRef.current[id]
    }
    for (const idx of Object.keys(linkElementsRef.current)) {
      if (Number(idx) >= newLinks.length) delete linkElementsRef.current[Number(idx)]
    }

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

  /** Screen pixels to graph coordinates, undoing the current pan and zoom. */
  const toGraph = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const cam = cameraRef.current
    return {
      x: (clientX - rect.left - cam.x) / cam.zoom,
      y: (clientY - rect.top - cam.y) / cam.zoom
    }
  }, [])

  // 4. Drag a node, or pan the background
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    let moved = false

    dragNodeIdRef.current = nodeId
    setDraggingId(nodeId)
    const node = nodesRef.current.find(n => n.id === nodeId)
    const at = toGraph(e.clientX, e.clientY)
    if (node) { node.fx = at.x; node.fy = at.y }
    ensureRunning()

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      if (!dragNodeIdRef.current) return
      if (Math.abs(moveEvent.clientX - startX) > DRAG_THRESHOLD || Math.abs(moveEvent.clientY - startY) > DRAG_THRESHOLD) {
        moved = true
      }
      const target = nodesRef.current.find(n => n.id === dragNodeIdRef.current)
      if (target) {
        // Recomputed from the live rect every move, so a resize or a scroll
        // mid-drag cannot leave the node offset from the cursor.
        const p = toGraph(moveEvent.clientX, moveEvent.clientY)
        target.fx = p.x
        target.fy = p.y
      }
    }

    const handleMouseUp = (): void => {
      const id = dragNodeIdRef.current
      if (id) {
        const target = nodesRef.current.find(n => n.id === id)
        if (target) { target.fx = null; target.fy = null }
      }
      dragNodeIdRef.current = null
      setDraggingId(null)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      // A press with no meaningful movement is a click → open the note
      if (!moved && id) {
        const node = nodesRef.current.find(n => n.id === id)
        // A missing note has nothing to open. Selecting it would create one,
        // which is not what clicking a graph should do behind your back.
        if (node && !node.missing) onSelectNote(id)
      }
      ensureRunning()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const handleBackgroundMouseDown = (e: React.MouseEvent): void => {
    const startX = e.clientX
    const startY = e.clientY
    const origin = cameraRef.current

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      setCamera({
        ...origin,
        x: origin.x + (moveEvent.clientX - startX),
        y: origin.y + (moveEvent.clientY - startY)
      })
    }
    const handleMouseUp = (): void => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // Zoom toward the pointer, so the thing under the cursor stays under it.
  const handleWheel = (e: React.WheelEvent): void => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const cam = cameraRef.current
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor))
    if (zoom === cam.zoom) return
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const ratio = zoom / cam.zoom
    setCamera({ zoom, x: px - (px - cam.x) * ratio, y: py - (py - cam.y) * ratio })
  }

  const viewMoved = camera.x !== 0 || camera.y !== 0 || camera.zoom !== 1
  const showEveryLabel = camera.zoom >= LABEL_ZOOM || nodes.length <= LABEL_NODE_LIMIT
  const unresolvedCount = nodes.filter(n => n.missing).length

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
        <>
          <svg
            ref={svgRef}
            width={dimensions.width}
            height={dimensions.height}
            onMouseDown={handleBackgroundMouseDown}
            onWheel={handleWheel}
            onMouseLeave={() => setHoverId(null)}
            style={{
              display: 'block',
              pointerEvents: 'auto',
              cursor: draggingId ? 'grabbing' : 'grab',
              touchAction: 'none'
            }}
          >
            <g transform={`translate(${camera.x}, ${camera.y}) scale(${camera.zoom})`}>
              <g>
                {links.map((link, idx) => {
                  // With something hovered, only its own edges stay solid.
                  const lit = !focus || (focus.has(link.source) && focus.has(link.target))
                  return (
                    <line
                      key={`${link.source}-${link.target}-${idx}`}
                      ref={el => { linkElementsRef.current[idx] = el }}
                      stroke={lit && focus ? 'var(--color-primary)' : 'var(--color-surface-offset)'}
                      strokeWidth={lit && focus ? 2 : 1.5}
                      style={{ opacity: focus ? (lit ? 0.9 : 0.12) : 0.7, transition: 'opacity 0.15s, stroke 0.15s' }}
                    />
                  )
                })}
              </g>
              <g>
                {nodes.map(node => {
                  const isActive = node.id === activeTitle
                  const inFocus = !focus || focus.has(node.id)
                  const r = radiusFor(node, isActive)
                  const labelled = isActive || node.id === hoverId || showEveryLabel || (focus?.has(node.id) ?? false)
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
                      onMouseDown={e => handleNodeMouseDown(e, node.id)}
                      onMouseEnter={() => setHoverId(node.id)}
                      onMouseLeave={() => setHoverId(null)}
                      style={{
                        cursor: draggingId === node.id ? 'grabbing' : node.missing ? 'default' : 'pointer',
                        opacity: inFocus ? 1 : 0.2,
                        transition: 'opacity 0.15s'
                      }}
                    >
                      {/* An invisible disc so small nodes are still easy to hit. */}
                      <circle r={Math.max(r + 6, 11)} fill="transparent" />
                      <circle
                        r={r}
                        // Hollow means linked to but never written.
                        fill={node.missing ? 'transparent' : isActive ? 'var(--color-secondary)' : 'var(--color-primary)'}
                        stroke={node.missing ? 'var(--color-text-faint)' : 'var(--color-surface-offset)'}
                        strokeWidth="1.5"
                        strokeDasharray={node.missing ? '2 2' : undefined}
                        style={{
                          filter: isActive ? 'drop-shadow(0 0 4px var(--color-secondary))' : 'none',
                          transition: 'fill 0.2s, r 0.2s'
                        }}
                      />
                      {labelled && (
                        <text
                          dy={r + 11}
                          textAnchor="middle"
                          fill={isActive ? 'var(--color-text-base)' : node.missing ? 'var(--color-text-faint)' : 'var(--color-text-muted)'}
                          style={{
                            // Held at a constant on-screen size, or zooming in
                            // turns the labels into billboards.
                            fontSize: `${10 / camera.zoom}px`,
                            fontFamily: 'var(--font-sans)',
                            fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                            fontStyle: node.missing ? 'italic' : 'normal',
                            userSelect: 'none',
                            pointerEvents: 'none'
                          }}
                        >
                          {node.id}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            </g>
          </svg>

          {/* Counts and a way back. Both only when they say something. */}
          <div style={{
            position: 'absolute', left: 'var(--space-2)', bottom: 'var(--space-2)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)',
            pointerEvents: 'none'
          }}>
            <span>{nodes.length - unresolvedCount} notes, {links.length} links</span>
            {unresolvedCount > 0 && (
              <span style={{ fontStyle: 'italic' }} title="Linked to, but no note of that name exists yet">
                {unresolvedCount} not written
              </span>
            )}
          </div>

          {viewMoved && (
            <button
              onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}
              style={{
                position: 'absolute', right: 'var(--space-2)', bottom: 'var(--space-2)',
                background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)',
                fontSize: 'var(--text-2xs)', padding: '3px 8px', cursor: 'pointer'
              }}
            >
              Reset view
            </button>
          )}
        </>
      )}
    </div>
  )
}
