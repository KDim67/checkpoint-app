import { useRef, type Dispatch, type SetStateAction } from 'react'
import { setNumberSetting } from '../../lib/settings'
import { RAIL_WIDTH_KEY, clampRail } from './wallPreferences'

interface WallRailHandleProps {
  railWidth: number
  setRailWidth: Dispatch<SetStateAction<number>>
}

export default function WallRailHandle({ railWidth, setRailWidth }: WallRailHandleProps) {
  const railResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  return (
    <div
      onPointerDown={e => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        railResizeRef.current = { startX: e.clientX, startWidth: railWidth }
      }}
      onPointerMove={e => {
        const resize = railResizeRef.current
        // inverted: the handle is on the left edge, dragging left widens
        if (resize) setRailWidth(clampRail(resize.startWidth - (e.clientX - resize.startX)))
      }}
      onPointerUp={e => {
        if (!railResizeRef.current) return
        railResizeRef.current = null
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
        void setNumberSetting(RAIL_WIDTH_KEY, railWidth)
      }}
      role="separator"
      aria-label="Resize the board panel"
      style={{
        width: '5px', flexShrink: 0, cursor: 'col-resize',
        background: 'var(--color-surface-offset)'
      }}
    />
  )
}
