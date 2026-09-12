import { Layers, Sparkles } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { texturePathsIn } from '@shared/texturePaths'

export default function CardTextureTools({ body, cardId, onClose }: { body: string; cardId: string; onClose: () => void }) {
  const paths = texturePathsIn(body)

  if (paths.length === 0) return null

  return (
    <div style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      marginTop: 'var(--space-2)'
    }}>
      <div className="row">
        <Sparkles size={14} style={{ color: 'var(--color-secondary)' }} />
        <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Game Dev: Texture Tooling Detected
        </span>
      </div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
        This ticket references local texture files. You can generate Normal/Height/Roughness/AO maps, or blend them into seamless tiling textures.
      </p>
      <div className="col">
        {paths.map((path, idx) => {
          const fileName = path.split('/').pop() || path;
          return (
            <div key={idx} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1, marginRight: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fileName}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>
                  {path}
                </span>
              </div>
              
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                {/* Generate Maps (PBR) Button */}
                <button
                  onClick={() => {
                    useAppStore.getState().setGamedevPreloadTexture(path, cardId);
                    useAppStore.getState().setView('gamedev');
                    onClose();
                  }}
                  style={{
                    background: 'var(--color-primary)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'white',
                    fontSize: '11px',
                    fontWeight: 'var(--weight-semibold)',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--color-primary-hover)'}
                  onMouseOut={e => e.currentTarget.style.background = 'var(--color-primary)'}
                >
                  <Sparkles size={12} />
                  <span>PBR Maps</span>
                </button>

                {/* Make Seamless Button */}
                <button
                  onClick={() => {
                    useAppStore.getState().setGamedevPreloadSeamless(path, cardId);
                    useAppStore.getState().setView('gamedev');
                    onClose();
                  }}
                  style={{
                    background: 'var(--color-surface-offset)',
                    border: '1px solid var(--color-balance)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-base)',
                    fontSize: '11px',
                    fontWeight: 'var(--weight-semibold)',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  onMouseOver={e => {
                    e.currentTarget.style.background = 'var(--color-surface-2)'
                    e.currentTarget.style.borderColor = 'var(--color-secondary)'
                  }}
                  onMouseOut={e => {
                    e.currentTarget.style.background = 'var(--color-surface-offset)'
                    e.currentTarget.style.borderColor = 'var(--color-balance)'
                  }}
                >
                  <Layers size={12} style={{ color: 'var(--color-secondary)' }} />
                  <span>Make Seamless</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  )
}
