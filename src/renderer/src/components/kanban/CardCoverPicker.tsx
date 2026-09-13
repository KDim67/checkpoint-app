import ColorPicker from '../ui/ColorPicker'

export type CardCover = { type: 'color' | 'image'; value: string; size?: 'header' | 'full' }

export default function CardCoverPicker({ cover, onChange }: { cover: CardCover | null; onChange: (next: CardCover | null) => void }) {
  return (
    <div className="col-sm">
      <span className="label-caps">
        Cover Color & Mode
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* header strip vs full background */}
        {cover && cover.type === 'color' && (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '2px' }}>
            <button
              type="button"
              onClick={() => {
                const nextCover = { ...cover, size: 'header' as const }
                onChange(nextCover)
              }}
              style={{
                flex: 1,
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: (cover.size !== 'full') ? 'var(--color-primary)' : 'var(--color-surface-1)',
                color: (cover.size !== 'full') ? '#ffffff' : 'var(--color-text-muted)',
                border: '1px solid var(--color-surface-offset)'
              }}
            >
              <div style={{ width: '12px', height: '10px', borderRadius: '2px', border: '1px solid currentColor', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: '4px', background: 'currentColor' }} />
              </div>
              <span>Header</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const nextCover = { ...cover, size: 'full' as const }
                onChange(nextCover)
              }}
              style={{
                flex: 1,
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: (cover.size === 'full') ? 'var(--color-primary)' : 'var(--color-surface-1)',
                color: (cover.size === 'full') ? '#ffffff' : 'var(--color-text-muted)',
                border: '1px solid var(--color-surface-offset)'
              }}
            >
              <div style={{ width: '12px', height: '10px', borderRadius: '2px', background: 'currentColor' }} />
              <span>Full Card</span>
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', height: '100%', minHeight: '36px' }}>
          {['none', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#a855f7', '#ec4899'].map(color => {
            const isSelected = color === 'none' ? !cover : (cover?.type === 'color' && cover.value === color)
            return (
              <button
                key={color}
                onClick={() => {
                  if (color === 'none') {
                    onChange(null)
                  } else {
                    const size = cover?.size || 'header'
                    const nextCover = { type: 'color' as const, value: color, size }
                    onChange(nextCover)
                  }
                }}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '4px',
                  background: color === 'none' ? 'transparent' : color,
                  border: isSelected 
                    ? '2px solid var(--color-text-base)' 
                    : (color === 'none' ? '1px dashed var(--color-text-muted)' : '1px solid transparent'),
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-base)',
                  fontSize: '9px'
                }}
                title={color === 'none' ? 'No Cover' : color}
              >
                {color === 'none' && '×'}
              </button>
            )
          })}
          <ColorPicker
            value={cover?.type === 'color' ? cover.value : ''}
            onLiveDomUpdate={col => {
              const banner = document.getElementById('card-modal-cover-banner')
              if (banner) banner.style.backgroundColor = col
            }}
            onCommit={col => {
              if (col) {
                const size = cover?.size || 'header'
                const nextCover = { type: 'color' as const, value: col, size }
                onChange(nextCover)
              } else {
                onChange(null)
              }
            }}
            swatchSize={20}
            hexInputWidth={58}
            title="Custom Cover Hexcode"
          />
        </div>
      </div>
    </div>
  )
}
