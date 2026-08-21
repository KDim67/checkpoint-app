import React from 'react'
import { CheckCircle, Download, Loader, Maximize2, Plus, Settings } from 'lucide-react'
import type { UpscalerTool } from './useUpscalerTool'

export default function UpscalerPanel({ tool }: { tool: UpscalerTool }) {
  const {
    upscalePath,
    upscaleUrl,
    upscaleAlgorithm,
    setUpscaleAlgorithm,
    upscaleExportedPath,
    isUpscaleSaving,
    upscaleDims,
    upscaleShowOriginal,
    setUpscaleShowOriginal,
    upscalePreviewCanvasRef,
    handleSelectUpscaleFile,
    handleUpscaleDrop,
    handleUpscaleExport
  } = tool

  return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
        <div className="gamedev-info-banner">
          <Maximize2 size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Pixel Art Upscaler:</strong> Upscale retro low-resolution textures using crisp integer multipliers or classic Scale2x/Scale3x interpolation rules.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 'var(--space-4)', minHeight: 0, flex: 1 }}>
          {/* Left Configuration Column */}
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
                Upscale Settings
              </span>
            </div>

            {/* File picker */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                Source Image
              </span>
              <button
                onClick={handleSelectUpscaleFile}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-base)',
                  fontSize: 'var(--text-xs)',
                  padding: '10px var(--space-3)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  overflow: 'hidden'
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 'var(--space-2)' }}>
                  {upscalePath ? upscalePath.split(/[\\/]/).pop() : 'Load Texture...'}
                </span>
                <Plus size={14} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
              </button>
            </div>

            {/* Algorithm selection dropdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                Scaling Filter
              </span>
              <select
                value={upscaleAlgorithm}
                onChange={e => setUpscaleAlgorithm(e.target.value as any)}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-base)',
                  fontSize: 'var(--text-xs)',
                  padding: '8px var(--space-2)',
                  cursor: 'pointer',
                  width: '100%',
                  outline: 'none'
                }}
              >
                <optgroup label="Edge-smart (EPX / AdvMAME)">
                  <option value="scale2x">Scale2x, smoothed edges, 2×</option>
                  <option value="scale3x">Scale3x, smoothed edges, 3×</option>
                  <option value="scale4x">Scale4x, smoothed edges, 4×</option>
                </optgroup>
                <optgroup label="Crisp (Nearest Neighbor)">
                  <option value="nearest2x">Nearest 2×, exact pixels</option>
                  <option value="nearest4x">Nearest 4×, exact pixels</option>
                  <option value="nearest8x">Nearest 8×, exact pixels</option>
                </optgroup>
              </select>
              <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
                Scale2x/3x/4x round jagged staircase edges without blurring. Nearest keeps every pixel perfectly square.
              </span>
            </div>

            {/* Before / after compare */}
            {upscaleUrl && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={upscaleShowOriginal}
                  onChange={e => setUpscaleShowOriginal(e.target.checked)}
                />
                <span>Compare: show original (nearest-scaled)</span>
              </label>
            )}
          </div>

          {/* Right Viewport Column */}
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
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                  {upscaleShowOriginal ? 'Viewing: Original (nearest-scaled for comparison)' : 'Viewing: Upscaled result'}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', fontFamily: 'var(--font-mono)' }}>
                  {upscaleDims
                    ? `${upscaleDims.w}×${upscaleDims.h} → ${upscaleDims.ow}×${upscaleDims.oh} (${Math.round(upscaleDims.ow / upscaleDims.w)}×)`
                    : 'Idle, load or drop an image'}
                </span>
              </div>
            </div>

            {/* Viewport canvas, accepts drag & drop */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleUpscaleDrop}
              style={{
                flex: 1,
                background: 'var(--color-background)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-surface-offset)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 'var(--space-4)',
                overflow: 'hidden'
              }}
            >
              {!upscaleUrl ? (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Maximize2 size={40} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>No Image Loaded</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Drop a pixel-art image here, or browse for one.</span>
                  </div>
                  <button
                    onClick={handleSelectUpscaleFile}
                    style={{
                      background: 'linear-gradient(135deg, var(--color-primary) 0%, #0055ff 100%)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      color: 'white',
                      fontWeight: 'var(--weight-semibold)',
                      fontSize: 'var(--text-xs)',
                      padding: '10px 20px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(30, 69, 252, 0.3)'
                    }}
                  >
                    Choose Image
                  </button>
                </div>
              ) : (
                // imageRendering: pixelated, without it the browser's smooth
                // downscale blurs the crisp result, defeating the whole tool
                <canvas
                  ref={upscalePreviewCanvasRef}
                  style={{
                    width: '100%',
                    height: '100%',
                    maxWidth: '520px',
                    maxHeight: '520px',
                    objectFit: 'contain',
                    imageRendering: 'pixelated',
                    background: '#0b0c10',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
                  }}
                />
              )}
            </div>

            {/* Export trigger */}
            {upscalePath && upscaleUrl && (
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
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export Upscaled</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      Saves upscaled texture next to original image with an upscaled suffix.
                    </span>
                  </div>
                  <button
                    onClick={handleUpscaleExport}
                    disabled={isUpscaleSaving}
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
                      opacity: isUpscaleSaving ? 0.7 : 1,
                      boxShadow: '0 4px 12px rgba(0, 200, 100, 0.3)'
                    }}
                  >
                    {isUpscaleSaving ? (
                      <>
                        <Loader size={14} className="animate-spin" />
                        <span>Exporting...</span>
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        <span>Save Upscaled</span>
                      </>
                    )}
                  </button>
                </div>

                {upscaleExportedPath && (
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
                      <strong>Upscaled successfully saved!</strong>
                    </div>
                    <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>Saved Path: {upscaleExportedPath}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
  )
}
