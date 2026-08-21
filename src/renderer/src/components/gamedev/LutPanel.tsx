import React from 'react'
import { CheckCircle, Download, Loader, Settings, Sliders } from 'lucide-react'
import type { LutTool } from './useLutTool'

export default function LutPanel({ tool }: { tool: LutTool }) {
  const {
    lutBrightness,
    setLutBrightness,
    lutContrast,
    setLutContrast,
    lutSaturation,
    setLutSaturation,
    lutTemperature,
    setLutTemperature,
    lutExposure,
    setLutExposure,
    lutExportedPath,
    isLutSaving,
    lutPreviewCanvasRef,
    handleLutExport
  } = tool

  return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
        <div className="gamedev-info-banner">
          <Sliders size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>LUT Color Grader:</strong> Real-time color correction editor. Adjust filters and sliders to grade a standard neutral 3D look-up table strip ($256\times16$ pixels), compatible with Unity, Unreal, and Godot.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 'var(--space-4)', minHeight: 0, flex: 1 }}>
          {/* Left Columns Sliders */}
          <div style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
              <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
              <span className="label-caps">
                Color Adjustments
              </span>
            </div>

            {/* Exposure Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Exposure</span>
                <span style={{ color: 'var(--color-secondary)' }}>{lutExposure > 0 ? `+${lutExposure}` : lutExposure}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={lutExposure}
                onChange={e => setLutExposure(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>

            {/* Brightness Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Brightness</span>
                <span style={{ color: 'var(--color-secondary)' }}>{lutBrightness > 0 ? `+${lutBrightness}` : lutBrightness}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={lutBrightness}
                onChange={e => setLutBrightness(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>

            {/* Contrast Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Contrast</span>
                <span style={{ color: 'var(--color-secondary)' }}>{lutContrast > 0 ? `+${lutContrast}` : lutContrast}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={lutContrast}
                onChange={e => setLutContrast(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>

            {/* Saturation Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Saturation</span>
                <span style={{ color: 'var(--color-secondary)' }}>{lutSaturation > 0 ? `+${lutSaturation}` : lutSaturation}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={lutSaturation}
                onChange={e => setLutSaturation(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>

            {/* Temperature Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Temperature</span>
                <span style={{ color: 'var(--color-secondary)' }}>{lutTemperature > 0 ? `Warm (+${lutTemperature})` : lutTemperature < 0 ? `Cool (${lutTemperature})` : 'Neutral'}</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={lutTemperature}
                onChange={e => setLutTemperature(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>

            {/* Reset button */}
            <button
              onClick={() => {
                setLutExposure(0)
                setLutBrightness(0)
                setLutContrast(0)
                setLutSaturation(0)
                setLutTemperature(0)
              }}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-muted)',
                fontSize: '11px',
                padding: '8px 12px',
                cursor: 'pointer',
                marginTop: 'var(--space-2)'
              }}
            >
              Reset Defaults
            </button>
          </div>

          {/* Right Preview Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
            {/* Meta header */}
            <div style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-3) var(--space-4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Grader Viewport:</span>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                  Color Spectrum (Left) | Demo Scene (Right) | LUT Strip (Bottom)
                </span>
              </div>
            </div>

            {/* Canvas viewport */}
            <div style={{
              flex: 1,
              background: 'var(--color-background)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-surface-offset)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-4)',
              overflow: 'hidden'
            }}>
              <canvas ref={lutPreviewCanvasRef} style={{ width: '100%', height: '100%', maxWidth: '512px', maxHeight: '272px', objectFit: 'contain', background: '#0b0c10', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
            </div>

            {/* Export LUT Strip */}
            <div style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)'
            }}>
              <div className="row-between">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export LUT Strip</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                    Saves standard neutral 3D lut slice strip ($256\times16$ px) next to currently loaded project assets.
                  </span>
                </div>
                <button
                  onClick={handleLutExport}
                  disabled={isLutSaving}
                  style={{
                    background: 'linear-gradient(135deg, var(--color-secondary) 0%, #00aa55 100%)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text-inverted)',
                    fontWeight: 'var(--weight-semibold)',
                    padding: '10px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: isLutSaving ? 0.7 : 1,
                    boxShadow: '0 4px 12px rgba(0, 200, 100, 0.3)'
                  }}
                >
                  {isLutSaving ? (
                    <>
                      <Loader size={14} className="animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      <span>Export LUT strip</span>
                    </>
                  )}
                </button>
              </div>

              {lutExportedPath && (
                <div style={{
                  background: 'rgba(0, 255, 128, 0.05)',
                  border: '1px solid rgba(0, 255, 128, 0.2)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: '11px',
                  color: 'var(--color-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle size={13} />
                    <strong>LUT generated successfully!</strong>
                  </div>
                  <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>Saved Path: {lutExportedPath}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
  )
}
