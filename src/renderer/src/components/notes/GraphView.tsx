import React, { useEffect, useRef, useState } from 'react'
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

export default function GraphView({ notes, activeTitle, onSelectNote }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dimensions, setDimensions] = useState({ width: 300, height: 300 })

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])

  const nodesRef = useRef<GraphNode[]>([])
  const linksRef = useRef<GraphLink[]>([])

  const nodeElementsRef = useRef<Record<string, SVGGElement | null>>({})
  const linkElementsRef = useRef<Record<number, SVGLineElement | null>>({})

  const animationFrameRef = useRef<number | null>(null)
  const dragNodeIdRef = useRef<string | null>(null)

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

  // 2. Build nodes and links list when notes change, preserving existing positions
  useEffect(() => {
    const existingNodesMap = new Map<string, GraphNode>()
    nodesRef.current.forEach(n => {
      existingNodesMap.set(n.id, n)
    })

    const { width, height } = dimensions
    const centerX = width / 2
    const centerY = height / 2

    // Create unique nodes
    const newNodesList: GraphNode[] = notes.map(note => {
      const existing = existingNodesMap.get(note.title)
      if (existing) return existing

      // Spawn in a slight offset from center
      const angle = Math.random() * Math.PI * 2
      const radius = 20 + Math.random() * 30
      return {
        id: note.title,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null
      }
    })

    // Create unique edges based on wiki-links
    const newLinksList: GraphLink[] = []
    const noteTitlesSet = new Set(notes.map(n => n.title))

    notes.forEach(note => {
      note.links.forEach(target => {
        // Only draw links pointing to actual existing notes
        if (noteTitlesSet.has(target)) {
          // Normalize link order to prevent double-directed links between same notes
          const [first, second] = [note.title, target].sort()
          const linkExists = newLinksList.some(
            l => l.source === first && l.target === second
          )
          if (!linkExists) {
            newLinksList.push({
              source: first,
              target: second
            })
          }
        }
      })
    })

    // Bind objects together
    newLinksList.forEach(link => {
      link.sourceNode = newNodesList.find(n => n.id === link.source)
      link.targetNode = newNodesList.find(n => n.id === link.target)
    })

    nodesRef.current = newNodesList
    linksRef.current = newLinksList

    setNodes(newNodesList)
    setLinks(newLinksList)
  }, [notes, dimensions])

  // 3. Physics Simulation Loop
  useEffect(() => {
    const runPhysicsFrame = () => {
      const currentNodes = nodesRef.current
      const currentLinks = linksRef.current
      const { width, height } = dimensions
      const centerX = width / 2
      const centerY = height / 2

      // Constants
      const repulsion = 180
      const spring = 0.05
      const restLength = 65
      const gravity = 0.012
      const friction = 0.82

      // 3a. Node Repulsion (Coulomb's Law)
      for (let i = 0; i < currentNodes.length; i++) {
        const nodeA = currentNodes[i]
        for (let j = i + 1; j < currentNodes.length; j++) {
          const nodeB = currentNodes[j]

          const dx = nodeB.x - nodeA.x
          const dy = nodeB.y - nodeA.y
          const distSq = dx * dx + dy * dy
          const dist = Math.sqrt(distSq) || 0.1

          // Repulsive force
          const force = repulsion / (distSq + 10)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force

          nodeA.vx -= fx
          nodeA.vy -= fy
          nodeB.vx += fx
          nodeB.vy += fy
        }
      }

      // 3b. Spring Link Attraction (Hooke's Law)
      for (const link of currentLinks) {
        if (!link.sourceNode || !link.targetNode) continue
        const nodeA = link.sourceNode
        const nodeB = link.targetNode

        const dx = nodeB.x - nodeA.x
        const dy = nodeB.y - nodeA.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1

        const force = spring * (dist - restLength)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force

        nodeA.vx += fx
        nodeA.vy += fy
        nodeB.vx -= fx
        nodeB.vy -= fy
      }

      // 3c. Center Gravity
      for (const node of currentNodes) {
        const dx = centerX - node.x
        const dy = centerY - node.y

        node.vx += dx * gravity
        node.vy += dy * gravity
      }

      // 3d. Update positions & velocities
      for (const node of currentNodes) {
        if (node.fx !== null && node.fy !== null) {
          node.x = node.fx
          node.y = node.fy
          node.vx = 0
          node.vy = 0
        } else {
          node.x += node.vx
          node.y += node.vy
          node.vx *= friction
          node.vy *= friction
        }

        // Bound nodes to screen viewport
        node.x = Math.max(12, Math.min(width - 12, node.x))
        node.y = Math.max(12, Math.min(height - 12, node.y))
      }

      // 3e. Update DOM elements directly for extreme performance
      currentNodes.forEach(node => {
        const el = nodeElementsRef.current[node.id]
        if (el) {
          el.setAttribute('transform', `translate(${node.x}, ${node.y})`)
        }
      })

      currentLinks.forEach((link, idx) => {
        const el = linkElementsRef.current[idx]
        if (el && link.sourceNode && link.targetNode) {
          el.setAttribute('x1', String(link.sourceNode.x))
          el.setAttribute('y1', String(link.sourceNode.y))
          el.setAttribute('x2', String(link.targetNode.x))
          el.setAttribute('y2', String(link.targetNode.y))
        }
      })

      // 3f. Check convergence, stop the loop when kinetic energy is negligible
      const totalKE = currentNodes.reduce((sum, n) => {
        // Only count free nodes (pinned nodes have fx/fy set)
        if (n.fx !== null && n.fy !== null) return sum
        return sum + n.vx * n.vx + n.vy * n.vy
      }, 0)
      if (totalKE < 0.01) {
        // Graph has settled, no need to keep looping
        animationFrameRef.current = null
        return
      }

      animationFrameRef.current = requestAnimationFrame(runPhysicsFrame)
    }

    animationFrameRef.current = requestAnimationFrame(runPhysicsFrame)

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [dimensions])

  // 4. Mouse Drag Handlers
  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    if (!svgRef.current) return

    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    dragNodeIdRef.current = nodeId
    const node = nodesRef.current.find(n => n.id === nodeId)
    if (node) {
      node.fx = x
      node.fy = y
    }

    // Restart the physics loop if it has already settled
    if (animationFrameRef.current === null) {
      const restartLoop = () => {
        const runPhysicsFrame = () => {
          const currentNodes = nodesRef.current
          const currentLinks = linksRef.current
          const { width, height } = dimensions
          const centerX = width / 2
          const centerY = height / 2
          const repulsion = 180, spring = 0.05, restLength = 65, gravity = 0.012, friction = 0.82
          for (let i = 0; i < currentNodes.length; i++) {
            const nodeA = currentNodes[i]
            for (let j = i + 1; j < currentNodes.length; j++) {
              const nodeB = currentNodes[j]
              const dx = nodeB.x - nodeA.x, dy = nodeB.y - nodeA.y
              const distSq = dx * dx + dy * dy, dist = Math.sqrt(distSq) || 0.1
              const force = repulsion / (distSq + 10)
              nodeA.vx -= (dx / dist) * force; nodeA.vy -= (dy / dist) * force
              nodeB.vx += (dx / dist) * force; nodeB.vy += (dy / dist) * force
            }
          }
          for (const link of currentLinks) {
            if (!link.sourceNode || !link.targetNode) continue
            const nA = link.sourceNode, nB = link.targetNode
            const dx = nB.x - nA.x, dy = nB.y - nA.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
            const force = spring * (dist - restLength)
            nA.vx += (dx / dist) * force; nA.vy += (dy / dist) * force
            nB.vx -= (dx / dist) * force; nB.vy -= (dy / dist) * force
          }
          for (const n of currentNodes) {
            n.vx += (centerX - n.x) * gravity; n.vy += (centerY - n.y) * gravity
          }
          for (const n of currentNodes) {
            if (n.fx !== null && n.fy !== null) {
              n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0
            } else {
              n.x += n.vx; n.y += n.vy; n.vx *= friction; n.vy *= friction
            }
            n.x = Math.max(12, Math.min(width - 12, n.x))
            n.y = Math.max(12, Math.min(height - 12, n.y))
          }
          currentNodes.forEach(n => {
            const el = nodeElementsRef.current[n.id]
            if (el) el.setAttribute('transform', `translate(${n.x}, ${n.y})`)
          })
          currentLinks.forEach((link, idx) => {
            const el = linkElementsRef.current[idx]
            if (el && link.sourceNode && link.targetNode) {
              el.setAttribute('x1', String(link.sourceNode.x)); el.setAttribute('y1', String(link.sourceNode.y))
              el.setAttribute('x2', String(link.targetNode.x)); el.setAttribute('y2', String(link.targetNode.y))
            }
          })
          const totalKE = currentNodes.reduce((s, n) => n.fx !== null && n.fy !== null ? s : s + n.vx*n.vx + n.vy*n.vy, 0)
          if (totalKE < 0.01) { animationFrameRef.current = null; return }
          animationFrameRef.current = requestAnimationFrame(runPhysicsFrame)
        }
        animationFrameRef.current = requestAnimationFrame(runPhysicsFrame)
      }
      restartLoop()
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragNodeIdRef.current) return
      const targetNode = nodesRef.current.find(n => n.id === dragNodeIdRef.current)
      if (targetNode) {
        const moveX = moveEvent.clientX - rect.left
        const moveY = moveEvent.clientY - rect.top
        targetNode.fx = moveX
        targetNode.fy = moveY
      }
    }

    const handleMouseUp = () => {
      if (dragNodeIdRef.current) {
        const targetNode = nodesRef.current.find(n => n.id === dragNodeIdRef.current)
        if (targetNode) {
          targetNode.fx = null
          targetNode.fy = null
        }
      }
      dragNodeIdRef.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
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
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{ display: 'block', pointerEvents: 'auto' }}
      >
        {/* Render links */}
        <g>
          {links.map((link, idx) => (
            <line
              key={`${link.source}-${link.target}-${idx}`}
              ref={el => {
                linkElementsRef.current[idx] = el
              }}
              stroke="var(--color-surface-offset)"
              strokeWidth="1.5"
              style={{ opacity: 0.7 }}
            />
          ))}
        </g>

        {/* Render nodes */}
        <g>
          {nodes.map(node => {
            const isActive = node.id === activeTitle
            return (
              <g
                key={node.id}
                ref={el => {
                  nodeElementsRef.current[node.id] = el
                }}
                onMouseDown={e => handleMouseDown(e, node.id)}
                onDoubleClick={() => onSelectNote(node.id)}
                style={{ cursor: dragNodeIdRef.current === node.id ? 'grabbing' : 'grab' }}
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
    </div>
  )
}
