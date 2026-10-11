import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { NoteMetadata } from '../../../../shared/types'
import { ALPHA_DRAG, ALPHA_MIN, CONVERGENCE_KE, cool, EXACT_UP_TO, graphShape, stepSimulation, type GraphLink, type GraphNode } from './graphPhysics'

interface GraphViewProps {
  notes: NoteMetadata[]
  activeTitle: string | null
  onSelectNote: (title: string) => void
}

const DRAG_THRESHOLD = 3 // px before a press counts as a drag
/** a big graph takes this many steps a frame and is drawn once, so it settles in a third of the time */
const STEPS_PER_FRAME_LARGE = 3
/** a node that has moved less than this since it was drawn isn't written again; most stop well before the layout does */
const MIN_PAINT_PX = 0.25

const MIN_ZOOM = 0.4
const MAX_ZOOM = 4
/** past this, labels have room */
const LABEL_ZOOM = 1.3
/** below this many nodes labels always fit */
const LABEL_NODE_LIMIT = 12

/** hubs read as hubs */
function radiusFor(node: GraphNode, isActive: boolean): number {
  if (isActive) return 8
  return Math.min(7.5, 4 + Math.sqrt(node.degree) * 1.1)
}

function GraphView({ notes, activeTitle, onSelectNote }: GraphViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dimensions, setDimensions] = useState({ width: 300, height: 300 })

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])

  /** view transform only, the physics never sees it */
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 })
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  const [hoverId, setHoverId] = useState<string | null>(null)
  /** state not a ref, or the grab cursor never appears */
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const nodesRef = useRef<GraphNode[]>([])
  const linksRef = useRef<GraphLink[]>([])
  const dimsRef = useRef(dimensions)
  dimsRef.current = dimensions

  const nodeElementsRef = useRef<Record<string, SVGGElement | null>>({})
  const linkElementsRef = useRef<Record<number, SVGLineElement | null>>({})

  const rafRef = useRef<number | null>(null)
  const dragNodeIdRef = useRef<string | null>(null)
  /** how hot the layout runs; it cools each step and the loop stops once it's cold */
  const alphaRef = useRef(1)
  /** what the nodes were last built from */
  const shapeRef = useRef<string | null>(null)
  /** where each node was last drawn */
  const paintedRef = useRef(new WeakMap<GraphNode, [number, number]>())

  /** one hop from the hovered node, itself included */
  const focus = useMemo(() => {
    if (!hoverId) return null
    const near = new Set<string>([hoverId])
    for (const l of links) {
      if (l.source === hoverId) near.add(l.target)
      else if (l.target === hoverId) near.add(l.source)
    }
    return near
  }, [hoverId, links])

  // one reusable loop, restart via ensureRunning(); heat raises how hot it runs, a drag keeps it warm
  const ensureRunning = useCallback((heat = 0) => {
    alphaRef.current = Math.max(alphaRef.current, heat)
    if (rafRef.current !== null) return
    const tick = (): void => {
      const { width, height } = dimsRef.current
      const dragging = dragNodeIdRef.current !== null
      const steps = nodesRef.current.length > EXACT_UP_TO ? STEPS_PER_FRAME_LARGE : 1
      let totalKE = 0
      for (let s = 0; s < steps; s++) {
        alphaRef.current = cool(alphaRef.current, dragging)
        totalKE = stepSimulation(nodesRef.current, linksRef.current, width, height, alphaRef.current)
      }

      // imperative paint for speed, only what moved enough to see
      const moved = new Set<GraphNode>()
      for (const n of nodesRef.current) {
        const el = nodeElementsRef.current[n.id]
        if (!el) continue
        const last = paintedRef.current.get(n)
        if (last && Math.abs(last[0] - n.x) < MIN_PAINT_PX && Math.abs(last[1] - n.y) < MIN_PAINT_PX) continue
        el.setAttribute('transform', `translate(${n.x}, ${n.y})`)
        paintedRef.current.set(n, [n.x, n.y])
        moved.add(n)
      }
      linksRef.current.forEach((link, idx) => {
        const el = linkElementsRef.current[idx]
        if (el && link.sourceNode && link.targetNode && (moved.has(link.sourceNode) || moved.has(link.targetNode))) {
          el.setAttribute('x1', String(link.sourceNode.x))
          el.setAttribute('y1', String(link.sourceNode.y))
          el.setAttribute('x2', String(link.targetNode.x))
          el.setAttribute('y2', String(link.targetNode.y))
        }
      })

      // loop while dragging or until settled, which the cooling makes certain
      if ((totalKE < CONVERGENCE_KE || alphaRef.current < ALPHA_MIN) && !dragging) {
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

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

  // keep positions, reheat so new nodes settle
  useEffect(() => {
    // every save reloads the list; the same notes and links leave the layout as it is instead of stirring it again
    const shape = graphShape(notes)
    if (shape === shapeRef.current) return
    shapeRef.current = shape

    const existing = new Map<string, GraphNode>()
    nodesRef.current.forEach(n => existing.set(n.id, n))

    const { width, height } = dimsRef.current
    const centerX = width / 2
    const centerY = height / 2

    // case-insensitive against real titles
    const canonical = new Map<string, string>()
    notes.forEach(n => canonical.set(n.title.toLowerCase(), n.title))

    // keep missing targets, the editor shows them as broken too
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
      // new nodes on a ring, no RNG
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

    // missing targets resolve to themselves so edges connect
    const resolve = new Map(canonical)
    missing.forEach((title, key) => resolve.set(key, title))

    const newLinks: GraphLink[] = []
    const seen = new Set<string>()
    notes.forEach(note => {
      note.links.forEach(target => {
        const realTarget = resolve.get(target.trim().toLowerCase())
        if (!realTarget || realTarget === note.title) return
        const [first, second] = [note.title, realTarget].sort()
        // NUL separator can't be forged by a title; escaped so the file stays text
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

    // prune keys for gone nodes and links
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

    // small kick so the layout reflows
    newNodes.forEach(n => {
      if (n.fx === null) { n.vx += (Math.cos(n.x) * 0.5); n.vy += (Math.sin(n.y) * 0.5) }
    })
    ensureRunning(1)
  }, [notes, ensureRunning])

  // reheat on resize and mount, stop on unmount
  useEffect(() => {
    ensureRunning(1)
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [dimensions, ensureRunning])

  /** undoes pan and zoom */
  const toGraph = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const cam = cameraRef.current
    return {
      x: (clientX - rect.left - cam.x) / cam.zoom,
      y: (clientY - rect.top - cam.y) / cam.zoom
    }
  }, [])

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
    ensureRunning(ALPHA_DRAG)

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      if (!dragNodeIdRef.current) return
      if (Math.abs(moveEvent.clientX - startX) > DRAG_THRESHOLD || Math.abs(moveEvent.clientY - startY) > DRAG_THRESHOLD) {
        moved = true
      }
      const target = nodesRef.current.find(n => n.id === dragNodeIdRef.current)
      if (target) {
        // live rect each move, so a resize or scroll mid-drag can't offset it
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
      // no real movement means a click, open the note
      if (!moved && id) {
        const node = nodesRef.current.find(n => n.id === id)
        // opening a missing note would create it
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

  // zoom toward the pointer
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
                  // the hovered node's own edges stay solid
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
                        // seed the transform so new nodes don't flash at origin
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
                      {/* invisible hit disc for small nodes */}
                      <circle r={Math.max(r + 6, 11)} fill="transparent" />
                      <circle
                        r={r}
                        // hollow: linked but never written
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
                            // constant on-screen size, or labels balloon on zoom
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

          {/* only when they say something */}
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

// the screen around it redraws on every key typed in a note; its thousands of nodes needn't
export default React.memo(GraphView)
