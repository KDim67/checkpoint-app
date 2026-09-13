import Skeleton from '../ui/Skeleton'

export default function KanbanSkeleton() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--color-background)'
    }}>
      <header style={{
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-6)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)',
        flexShrink: 0
      }}>
        <Skeleton width={180} height={20} />
      </header>
      <div style={{
        flex: 1,
        padding: 'var(--space-5) var(--space-6)',
        display: 'flex',
        gap: 'var(--space-4)',
        overflowX: 'auto',
        overflowY: 'hidden',
        alignItems: 'stretch',
        height: 'calc(100% - 52px)'
      }}>
        {[1, 2, 3].map(colIdx => (
          <div key={colIdx} style={{
            width: '300px',
            minWidth: '280px',
            flex: '0 0 300px',
            background: 'var(--color-surface-1)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-surface-offset)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            height: '100%',
            boxSizing: 'border-box',
            flexShrink: 0
          }}>
            {/* Column Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)', flexShrink: 0 }}>
              <Skeleton width="50%" height={18} />
              <Skeleton width={20} height={18} borderRadius="var(--radius-sm)" />
            </div>

            {/* Column Accent Line */}
            <div style={{ height: '3px', background: 'var(--color-surface-offset)', borderRadius: '2px', flexShrink: 0 }} />

            {/* Cards Container */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', overflow: 'hidden' }}>
              {[1, 2, 3].map(cardIdx => (
                <div key={cardIdx} style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)'
                }}>
                  {/* Title block */}
                  <Skeleton width={`${80 - cardIdx * 10}%`} height={14} />
                  {/* Body blocks */}
                  <div className="col-6px">
                    <Skeleton width="90%" height={10} />
                    <Skeleton width="45%" height={10} />
                  </div>
                  {/* Meta tag */}
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '4px' }}>
                    <Skeleton width={45} height={14} borderRadius="var(--radius-sm)" />
                    <Skeleton width={60} height={14} borderRadius="var(--radius-sm)" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
