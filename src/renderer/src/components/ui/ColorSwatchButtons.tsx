const SWATCH_COLORS = ['none', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#a855f7', '#ec4899']

/** The preset accents. Picking none clears the colour back to the default. */
export default function ColorSwatchButtons({ value, onPick }: { value: string | undefined; onPick: (color: string | undefined) => void }) {
  return (
    <>
      {SWATCH_COLORS.map(cVal => (
        <button
          type="button"
          key={cVal}
          onClick={() => onPick(cVal === 'none' ? undefined : cVal)}
          style={{
            width: '18px',
            height: '18px',
            borderRadius: '4px',
            background: cVal === 'none' ? 'transparent' : cVal,
            border: (value === cVal || (cVal === 'none' && !value)) ? '2px solid var(--color-text-base)' : (cVal === 'none' ? '1px dashed var(--color-text-muted)' : '1px solid transparent'),
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '9px',
            color: 'var(--color-text-base)'
          }}
          title={cVal === 'none' ? 'Default Accent' : cVal}
        >
          {cVal === 'none' && '×'}
        </button>
      ))}
    </>
  )
}
