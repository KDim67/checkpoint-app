import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { toolButton } from './wallButtons'

interface WallPresenterProps {
  index: number
  count: number
  label: string
  onStep: (delta: 1 | -1) => void
  onExit: () => void
}

/** over the canvas while presenting, so presses land here and not on the items; the bar says where you are */
export default function WallPresenter({ index, count, label, onStep, onExit }: WallPresenterProps) {
  return (
    <div data-wall-ui style={{ position: 'absolute', inset: 0, zIndex: 40 }}>
      <div
        role="toolbar"
        aria-label="Presenting"
        style={{
          position: 'absolute', bottom: 'var(--space-4)', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '4px var(--space-2)',
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-full)', boxShadow: 'var(--shadow-lg)'
        }}
      >
        {toolButton('Previous frame', <ChevronLeft size={14} />, () => onStep(-1), { disabled: index === 0 })}
        <span className="truncate" style={{ maxWidth: '260px', fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-base)' }}>
          {label}
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {index + 1} of {count}
        </span>
        {toolButton('Next frame', <ChevronRight size={14} />, () => onStep(1), { disabled: index >= count - 1 })}
        {toolButton('Stop presenting', <X size={14} />, onExit)}
      </div>
    </div>
  )
}
