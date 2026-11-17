import { useEffect, useMemo, useRef, useState } from 'react'
import { arrowAnchors, boundsOf as wallBounds, MAX_ZOOM, MIN_ZOOM, type WallCamera, type WallDoc, type WallItem } from '../../../../shared/wallModel'
import { paintWallCamera } from './wallPaint'

interface WallMinimapProps {
  items: WallItem[]
  selectedIds: Set<string>
  camera: WallCamera
  viewportRef: { current: HTMLDivElement | null }
  docRef: { current: WallDoc }
  setCamera: (camera: WallCamera) => void
}

export default function WallMinimap({ items, selectedIds, camera, viewportRef, docRef, setCamera }: WallMinimapProps) {
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(() => {
    const r = viewportRef.current?.getBoundingClientRect()
    return r && r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : null
  })

  const [isDragging, setIsDragging] = useState(false)
  const draggingRef = useRef(false)
  const latestCamRef = useRef<WallCamera | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const measure = () => {
      const r = viewportRef.current?.getBoundingClientRect()
      if (r && r.width > 0 && r.height > 0) {
        setViewportSize(prev => (prev?.width === r.width && prev?.height === r.height ? prev : { width: r.width, height: r.height }))
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [viewportRef])

  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const b = wallBounds(items)
  const rect = viewportSize ?? (viewportRef.current?.getBoundingClientRect() ? { width: viewportRef.current.getBoundingClientRect().width, height: viewportRef.current.getBoundingClientRect().height } : null)
  if (!b || !rect || rect.width <= 0 || rect.height <= 0) return null

  const W = 150
  const H = 110
  const pad = 8
  const contentW = Math.max(1, b.maxX - b.minX)
  const contentH = Math.max(1, b.maxY - b.minY)
  const k = Math.min((W - pad * 2) / contentW, (H - pad * 2) / contentH)
  const ox = pad - b.minX * k
  const oy = pad - b.minY * k

  // the camera's window, in the same space
  const viewX = (-camera.x / camera.zoom) * k + ox
  const viewY = (-camera.y / camera.zoom) * k + oy
  const viewW = (rect.width / camera.zoom) * k
  const viewH = (rect.height / camera.zoom) * k

  const computeCameraAt = (clientX: number, clientY: number, box: DOMRect): WallCamera => {
    const px = clientX - box.left
    const py = clientY - box.top
    const wx = (px - ox) / k
    const wy = (py - oy) / k
    const currentZoom = docRef.current.camera.zoom
    return {
      ...docRef.current.camera,
      x: rect.width / 2 - wx * currentZoom,
      y: rect.height / 2 - wy * currentZoom
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const el = e.currentTarget
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId)
      } catch {}
    }
    draggingRef.current = true
    setIsDragging(true)

    const box = el.getBoundingClientRect()
    const nextCam = computeCameraAt(e.clientX, e.clientY, box)
    latestCamRef.current = nextCam
    if (viewportRef.current) paintWallCamera(viewportRef.current, nextCam)
    setCamera(nextCam)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    const nextCam = computeCameraAt(e.clientX, e.clientY, box)
    latestCamRef.current = nextCam

    if (viewportRef.current) {
      paintWallCamera(viewportRef.current, nextCam)
    }

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        if (latestCamRef.current) {
          setCamera(latestCamRef.current)
        }
      })
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    e.stopPropagation()
    if (typeof e.currentTarget.releasePointerCapture === 'function') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
    }
    draggingRef.current = false
    setIsDragging(false)
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (latestCamRef.current) {
      setCamera(latestCamRef.current)
      latestCamRef.current = null
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left
    const py = e.clientY - box.top
    const wx = (px - ox) / k
    const wy = (py - oy) / k
    const currentCam = docRef.current.camera
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentCam.zoom * factor))
    if (newZoom === currentCam.zoom) return
    const newCam = {
      ...currentCam,
      zoom: newZoom,
      x: rect.width / 2 - wx * newZoom,
      y: rect.height / 2 - wy * newZoom
    }
    latestCamRef.current = newCam
    if (viewportRef.current) paintWallCamera(viewportRef.current, newCam)
    setCamera(newCam)
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      data-wall-ui
      data-wall-minimap
      title={isDragging ? 'Dragging view' : 'Drag or click to navigate'}
      style={{
        position: 'absolute', right: 'var(--space-3)', bottom: 'var(--space-3)',
        width: `${W}px`, height: `${H}px`, zIndex: 20,
        cursor: isDragging ? 'grabbing' : 'crosshair',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none'
      }}
    >
      {/* 1. Connector lines layer */}
      <svg
        data-wall-minimap-connectors
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}
      >
        {items.filter(i => i.kind === 'arrow').map(arrow => {
          const ends = arrowAnchors(arrow, itemsById)
          if (!ends) return null
          const isSel = selectedIds.has(arrow.id) || (arrow.from && selectedIds.has(arrow.from)) || (arrow.to && selectedIds.has(arrow.to))
          const fx = ends.from.x * k + ox
          const fy = ends.from.y * k + oy
          const tx = ends.to.x * k + ox
          const ty = ends.to.y * k + oy
          return (
            <line
              key={arrow.id}
              data-minimap-arrow={arrow.id}
              x1={fx}
              y1={fy}
              x2={tx}
              y2={ty}
              stroke={isSel ? 'var(--color-secondary, #38bdf8)' : (arrow.color || 'var(--color-surface-offset, #475569)')}
              strokeWidth={isSel ? 2 : 1}
              strokeDasharray={isSel ? '3 2' : undefined}
              opacity={isSel ? 1 : 0.45}
            />
          )
        })}
      </svg>

      {/* 2. Items & frames layer */}
      {items.filter(i => i.kind !== 'arrow').map(i => {
        const isSel = selectedIds.has(i.id)
        return (
          <div
            key={i.id}
            data-minimap-item={i.id}
            style={{
              position: 'absolute',
              left: `${i.x * k + ox}px`, top: `${i.y * k + oy}px`,
              width: `${Math.max(2, i.width * k)}px`, height: `${Math.max(2, i.height * k)}px`,
              background: i.kind === 'frame' ? 'transparent' : (i.color || 'var(--color-surface-offset)'),
              border: i.kind === 'frame' ? `1px solid ${i.color || 'var(--color-surface-elevated)'}` : undefined,
              borderRadius: '1px',
              outline: isSel ? '1.5px solid var(--color-secondary, #38bdf8)' : undefined,
              outlineOffset: isSel ? '1px' : undefined,
              boxShadow: isSel ? '0 0 4px var(--color-secondary, #38bdf8)' : undefined,
              zIndex: isSel ? 3 : 2,
              opacity: isSel ? 1 : 0.7,
              pointerEvents: 'none'
            }}
          />
        )
      })}
      <div
        data-wall-minimap-view
        // geometry on the element so a pan can move it without recomputing
        data-geom={`${k},${ox},${oy},${rect.width},${rect.height}`}
        style={{
          position: 'absolute',
          left: `${viewX}px`, top: `${viewY}px`,
          width: `${viewW}px`, height: `${viewH}px`,
          border: '1px solid var(--color-secondary)',
          background: 'var(--color-secondary-muted)',
          cursor: isDragging ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
          boxSizing: 'border-box'
        }}
      />
    </div>
  )
}
