import { boundsOf as wallBounds, type WallCamera, type WallDoc, type WallItem } from '../../../../shared/wallModel'

interface WallMinimapProps {
  items: WallItem[]
  selectedIds: Set<string>
  camera: WallCamera
  viewportRef: { current: HTMLDivElement | null }
  docRef: { current: WallDoc }
  setCamera: (camera: WallCamera) => void
}

export default function WallMinimap({ items, selectedIds, camera, viewportRef, docRef, setCamera }: WallMinimapProps) {
  const b = wallBounds(items)
  const rect = viewportRef.current?.getBoundingClientRect()
  if (!b || !rect) return null

  const W = 150
  const H = 110
  const pad = 8
  const contentW = Math.max(1, b.maxX - b.minX)
  const contentH = Math.max(1, b.maxY - b.minY)
  const k = Math.min((W - pad * 2) / contentW, (H - pad * 2) / contentH)
  const ox = pad - b.minX * k
  const oy = pad - b.minY * k

  // The camera's own window onto the wall, drawn in the same space.
  const viewX = (-camera.x / camera.zoom) * k + ox
  const viewY = (-camera.y / camera.zoom) * k + oy
  const viewW = (rect.width / camera.zoom) * k
  const viewH = (rect.height / camera.zoom) * k

  return (
    <div
      onPointerDown={e => {
        e.stopPropagation()
        // Click the map, go there: the wall point under the click
        // becomes the centre of the view.
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const wx = (e.clientX - box.left - ox) / k
        const wy = (e.clientY - box.top - oy) / k
        setCamera({
          ...docRef.current.camera,
          x: rect.width / 2 - wx * docRef.current.camera.zoom,
          y: rect.height / 2 - wy * docRef.current.camera.zoom
        })
      }}
      data-wall-ui
      title="Click to jump"
      style={{
        position: 'absolute', right: 'var(--space-3)', bottom: 'var(--space-3)',
        width: `${W}px`, height: `${H}px`, zIndex: 20, cursor: 'pointer',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden'
      }}
    >
      {items.filter(i => i.kind !== 'arrow').map(i => (
        <div
          key={i.id}
          style={{
            position: 'absolute',
            left: `${i.x * k + ox}px`, top: `${i.y * k + oy}px`,
            width: `${Math.max(2, i.width * k)}px`, height: `${Math.max(2, i.height * k)}px`,
            background: i.color || 'var(--color-surface-offset)',
            borderRadius: '1px',
            opacity: selectedIds.has(i.id) ? 1 : 0.7
          }}
        />
      ))}
      <div
        data-wall-minimap-view
        // Scale, offsets and the size of the viewport, so a pan can
        // move this without recomputing the whole map.
        data-geom={`${k},${ox},${oy},${rect.width},${rect.height}`}
        style={{
          position: 'absolute',
          left: `${viewX}px`, top: `${viewY}px`,
          width: `${viewW}px`, height: `${viewH}px`,
          border: '1px solid var(--color-secondary)',
          background: 'var(--color-secondary-muted)',
          pointerEvents: 'none'
        }}
      />
    </div>
  )
}
