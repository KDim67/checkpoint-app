import { useEffect, useRef } from 'react'
import { Upload } from 'lucide-react'
import ColorPicker from '../ui/ColorPicker'
import type { BoardConfig } from '../../lib/boardConfig'
import { getTextColorForBackground } from '../../lib/contrast'
import HeaderBtn from './HeaderBtn'
import { BG_STYLES } from './boardBackground'
import type { BoardTheme } from './useBoardTheme'

interface BoardThemeMenuProps {
  theme: BoardTheme
  persistConfig: (patch: Partial<BoardConfig>) => Promise<void>
}

export default function BoardThemeMenu({ theme, persistConfig }: BoardThemeMenuProps) {
  const {
    boardBg,
    setBoardBg,
    customBgTab,
    setCustomBgTab,
    customSolidColor,
    setCustomSolidColor,
    customGradStart,
    setCustomGradStart,
    customGradEnd,
    setCustomGradEnd,
    customGradAngle,
    setCustomGradAngle,
    customGradType,
    setCustomGradType,
    customImageUrl,
    setCustomImageUrl,
    showBgSelector,
    setShowBgSelector,
    handleFileUpload
  } = theme
  const bgSelectorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bgSelectorRef.current && !bgSelectorRef.current.contains(e.target as Node)) {
        setShowBgSelector(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setShowBgSelector])

  return (
    <div className="relative" ref={bgSelectorRef}>
      <HeaderBtn
        onClick={() => setShowBgSelector(v => !v)}
        title="Change board background theme"
        icon={
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/>
            <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>
            <path d="M12 2v2M12 20v2M20 12h2M2 12h2"/>
          </svg>
        }
        active={showBgSelector}
      >
        Theme
      </HeaderBtn>

      {showBgSelector && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 100,
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-xl)',
            width: '290px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
              Board Theme
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2px', background: 'var(--color-surface-2)', padding: '2px', borderRadius: 'var(--radius-md)' }}>
            <button
              onClick={() => setCustomBgTab('presets')}
              style={{
                padding: '4px 0',
                fontSize: '9px',
                fontWeight: 'var(--weight-semibold)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: customBgTab === 'presets' ? 'var(--color-surface-offset)' : 'transparent',
                color: customBgTab === 'presets' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                cursor: 'pointer'
              }}
            >
              Presets
            </button>
            <button
              onClick={() => setCustomBgTab('solid')}
              style={{
                padding: '4px 0',
                fontSize: '9px',
                fontWeight: 'var(--weight-semibold)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: customBgTab === 'solid' ? 'var(--color-surface-offset)' : 'transparent',
                color: customBgTab === 'solid' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                cursor: 'pointer'
              }}
            >
              Solid
            </button>
            <button
              onClick={() => setCustomBgTab('gradient')}
              style={{
                padding: '4px 0',
                fontSize: '9px',
                fontWeight: 'var(--weight-semibold)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: customBgTab === 'gradient' ? 'var(--color-surface-offset)' : 'transparent',
                color: customBgTab === 'gradient' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                cursor: 'pointer'
              }}
            >
              Gradient
            </button>
            <button
              onClick={() => setCustomBgTab('image')}
              style={{
                padding: '4px 0',
                fontSize: '9px',
                fontWeight: 'var(--weight-semibold)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: customBgTab === 'image' ? 'var(--color-surface-offset)' : 'transparent',
                color: customBgTab === 'image' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                cursor: 'pointer'
              }}
            >
              Wallpaper
            </button>
          </div>

          {customBgTab === 'presets' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '2px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {Object.keys(BG_STYLES).map(key => {
                  const isSel = boardBg === key
                  const styleVal = BG_STYLES[key]
                  return (
                    <button
                      key={key}
                      onClick={async () => {
                        setBoardBg(key)
                        setShowBgSelector(false)
                        try {
                          await persistConfig({ background: key })
                        } catch {}
                      }}
                      style={{
                        height: '32px',
                        borderRadius: 'var(--radius-md)',
                        border: isSel ? '2px solid var(--color-secondary)' : '1px solid var(--color-surface-offset)',
                        background: styleVal,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        fontWeight: 'var(--weight-bold)',
                        // not a token: sits on the preset's image, the shadow keeps it legible
                        color: '#fff',
                        textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                        textTransform: 'capitalize',
                        boxShadow: isSel ? '0 0 8px var(--color-secondary)50' : 'none'
                      }}
                    >
                      {key}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {customBgTab === 'solid' && (
            <div className="col-10px">
              <div
                id="kanban-solid-bg-preview"
                style={{
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  background: customSolidColor,
                  border: '1px solid var(--color-surface-offset)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: getTextColorForBackground(customSolidColor),
                  fontSize: '10px',
                  fontWeight: 'var(--weight-bold)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.6)'
                }}
              >
                {customSolidColor.toUpperCase()}
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                <ColorPicker
                  value={customSolidColor}
                  onLiveDomUpdate={col => {
                    const preview = document.getElementById('kanban-solid-bg-preview')
                    if (preview) {
                      preview.style.backgroundColor = col
                      preview.innerText = col.toUpperCase()
                    }
                  }}
                  onCommit={col => {
                    if (col) setCustomSolidColor(col)
                  }}
                  swatchSize={28}
                  hexInputWidth={80}
                  title="Choose Custom Board Color"
                />
              </div>

              <button
                onClick={async () => {
                  setBoardBg(customSolidColor)
                  setShowBgSelector(false)
                  try {
                    await persistConfig({ background: customSolidColor })
                  } catch {}
                }}
                style={{
                  padding: '7px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-secondary)',
                  color: '#0f172a',
                  fontWeight: 'var(--weight-bold)',
                  fontSize: '11px',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'center',
                  marginTop: '2px'
                }}
              >
                Apply Solid Color
              </button>
            </div>
          )}

          {customBgTab === 'gradient' && (
            <div className="col-10px">
              {(() => {
                const gradStr = customGradType === 'radial'
                  ? `radial-gradient(circle, ${customGradStart} 0%, ${customGradEnd} 100%)`
                  : `linear-gradient(${customGradAngle}deg, ${customGradStart} 0%, ${customGradEnd} 100%)`
                return (
                  <>
                    <div
                      id="kanban-gradient-bg-preview"
                      style={{
                        height: '44px',
                        borderRadius: 'var(--radius-md)',
                        background: gradStr,
                        border: '1px solid var(--color-surface-offset)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        // on the gradient, no single colour to contrast against
                        color: '#fff',
                        fontSize: '10px',
                        fontWeight: 'var(--weight-bold)',
                        textShadow: '0 1px 2px rgba(0,0,0,0.7)'
                      }}
                    >
                      Gradient Preview
                    </div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                        <span className="text-micro">Start Color</span>
                        <ColorPicker
                          value={customGradStart}
                          onLiveDomUpdate={col => {
                            const preview = document.getElementById('kanban-gradient-bg-preview')
                            if (preview) {
                              const str = customGradType === 'radial'
                                ? `radial-gradient(circle, ${col} 0%, ${customGradEnd} 100%)`
                                : `linear-gradient(${customGradAngle}deg, ${col} 0%, ${customGradEnd} 100%)`
                              preview.style.background = str
                            }
                          }}
                          onCommit={col => {
                            if (col) setCustomGradStart(col)
                          }}
                          swatchSize={22}
                          hexInputWidth={64}
                          title="Start Gradient Color"
                        />
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                        <span className="text-micro">End Color</span>
                        <ColorPicker
                          value={customGradEnd}
                          onLiveDomUpdate={col => {
                            const preview = document.getElementById('kanban-gradient-bg-preview')
                            if (preview) {
                              const str = customGradType === 'radial'
                                ? `radial-gradient(circle, ${customGradStart} 0%, ${col} 100%)`
                                : `linear-gradient(${customGradAngle}deg, ${customGradStart} 0%, ${col} 100%)`
                              preview.style.background = str
                            }
                          }}
                          onCommit={col => {
                            if (col) setCustomGradEnd(col)
                          }}
                          swatchSize={22}
                          hexInputWidth={64}
                          title="End Gradient Color"
                        />
                      </div>
                    </div>

                    <div className="row-between-8px">
                      <span className="text-micro">Gradient Style</span>
                      <div style={{ display: 'flex', gap: '4px', background: 'var(--color-surface-2)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
                        <button
                          onClick={() => setCustomGradType('linear')}
                          style={{
                            padding: '2px 8px',
                            fontSize: '10px',
                            border: 'none',
                            borderRadius: '2px',
                            background: customGradType === 'linear' ? 'var(--color-surface-offset)' : 'transparent',
                            color: customGradType === 'linear' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                            cursor: 'pointer'
                          }}
                        >
                          Linear
                        </button>
                        <button
                          onClick={() => setCustomGradType('radial')}
                          style={{
                            padding: '2px 8px',
                            fontSize: '10px',
                            border: 'none',
                            borderRadius: '2px',
                            background: customGradType === 'radial' ? 'var(--color-surface-offset)' : 'transparent',
                            color: customGradType === 'radial' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                            cursor: 'pointer'
                          }}
                        >
                          Radial
                        </button>
                      </div>
                    </div>

                    {customGradType === 'linear' && (
                      <div className="col-4px">
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-muted)' }}>
                          <span>Angle / Direction</span>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-secondary)', fontWeight: 'bold' }}>{customGradAngle}°</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="360"
                          value={customGradAngle}
                          onChange={e => setCustomGradAngle(Number(e.target.value))}
                          className="range-accent"
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', marginTop: '2px' }}>
                          {[0, 90, 135, 180].map(ang => (
                            <button
                              key={ang}
                              onClick={() => setCustomGradAngle(ang)}
                              style={{
                                padding: '2px 0',
                                fontSize: '9px',
                                borderRadius: '3px',
                                border: '1px solid var(--color-surface-offset)',
                                background: customGradAngle === ang ? 'var(--color-surface-offset)' : 'transparent',
                                color: customGradAngle === ang ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              {ang}°
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={async () => {
                        setBoardBg(gradStr)
                        setShowBgSelector(false)
                        try {
                          await persistConfig({ background: gradStr })
                        } catch {}
                      }}
                      style={{
                        padding: '7px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-secondary)',
                        color: '#0f172a',
                        fontWeight: 'var(--weight-bold)',
                        fontSize: '11px',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'center',
                        marginTop: '2px'
                      }}
                    >
                      Apply Gradient
                    </button>
                  </>
                )
              })()}
            </div>
          )}

          {customBgTab === 'image' && (
            <div className="col-10px">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                className="is-hidden"
                onChange={handleFileUpload}
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                className="board-theme-menu-upload hover-border-accent"
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-2)',
                  color: 'var(--color-text-base)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: 'var(--weight-semibold)',
                  transition: 'all 120ms ease'
                }}
              >
                <Upload size={18} className="text-accent" />
                <span>Upload Image from Computer</span>
                <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>PNG, JPG, WEBP, GIF (Max 8MB)</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '2px 0' }}>
                <div className="rule-fill" />
                <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>OR PASTE LINK</span>
                <div className="rule-fill" />
              </div>

              <input
                type="text"
                placeholder="Paste image URL (https://...)"
                value={customImageUrl.startsWith('data:') ? '[Uploaded Local File]' : customImageUrl}
                onChange={e => setCustomImageUrl(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: '11px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)'
                }}
              />

              {customImageUrl.trim() && (
                <div style={{
                  height: '60px',
                  borderRadius: 'var(--radius-md)',
                  background: `url("${customImageUrl.trim()}") center / cover no-repeat`,
                  border: '1px solid var(--color-surface-offset)',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  {/* white on its own black scrim, outside the theme */}
                  <span style={{ position: 'absolute', bottom: '4px', right: '6px', fontSize: '9px', background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: '4px', color: '#fff' }}>Preview</span>
                </div>
              )}

              <button
                disabled={!customImageUrl.trim()}
                onClick={async () => {
                  if (!customImageUrl.trim()) return
                  const imgVal = customImageUrl.trim()
                  setBoardBg(imgVal)
                  setShowBgSelector(false)
                  try {
                    await persistConfig({ background: imgVal })
                  } catch {}
                }}
                style={{
                  padding: '7px',
                  borderRadius: 'var(--radius-md)',
                  background: customImageUrl.trim() ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
                  color: customImageUrl.trim() ? '#0f172a' : 'var(--color-text-muted)',
                  fontWeight: 'var(--weight-bold)',
                  fontSize: '11px',
                  border: 'none',
                  cursor: customImageUrl.trim() ? 'pointer' : 'not-allowed',
                  textAlign: 'center',
                  marginTop: '2px'
                }}
              >
                Apply Wallpaper
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
