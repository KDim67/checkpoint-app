import React from 'react'
import type { UpscaleAlgorithm } from './types'
import { CheckCircle, Download, Loader, Maximize2 } from 'lucide-react'
import type { UpscalerTool } from './useUpscalerTool'
import FilePickerButton from './FilePickerButton'
import SettingsColumn from './SettingsColumn'
import NoImageLoaded from './NoImageLoaded'

export default function UpscalerPanel({ tool }: { tool: UpscalerTool }) {
  return (
      <div className="col-lg-full">
        <div className="gamedev-info-banner">
          <Maximize2 size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Pixel Art Upscaler:</strong> Upscale retro low-resolution textures using crisp integer multipliers or classic Scale2x/Scale3x interpolation rules.
          </div>
        </div>

        <div className="tool-layout">
          {/* Left Configuration Column */}
          <SettingsColumn title="Upscale Settings">

            {/* File picker */}
            <div className="col-6px">
              <span className="text-label-sm">
                Source Image
              </span>
              <FilePickerButton
                onClick={tool.handleSelectUpscaleFile}
                path={tool.upscalePath}
                placeholder="Load Texture..."
              />
            </div>

            {/* Algorithm selection dropdown */}
            <div className="col-4px">
              <span className="text-label-sm">
                Scaling Filter
              </span>
              <select
                value={tool.upscaleAlgorithm}
                onChange={e => tool.setUpscaleAlgorithm(e.target.value as UpscaleAlgorithm)}
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
                  <option value="scale2x">Scale2x. Smoothed edges, 2×</option>
                  <option value="scale3x">Scale3x. Smoothed edges, 3×</option>
                  <option value="scale4x">Scale4x. Smoothed edges, 4×</option>
                </optgroup>
                <optgroup label="Crisp (Nearest Neighbor)">
                  <option value="nearest2x">Nearest 2×. Exact pixels</option>
                  <option value="nearest4x">Nearest 4×. Exact pixels</option>
                  <option value="nearest8x">Nearest 8×. Exact pixels</option>
                </optgroup>
              </select>
              <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
                Scale2x/3x/4x round jagged staircase edges without blurring. Nearest keeps every pixel perfectly square.
              </span>
            </div>

            {/* Before / after compare */}
            {tool.upscaleUrl && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={tool.upscaleShowOriginal}
                  onChange={e => tool.setUpscaleShowOriginal(e.target.checked)}
                />
                <span>Compare: show original (nearest-scaled)</span>
              </label>
            )}
          </SettingsColumn>

          {/* Right Viewport Column */}
          <div className="col-lg-min">
            {/* Meta header */}
            <div className="panel-row">
              <div className="col-2px">
                <span className="text-caption">
                  {tool.upscaleShowOriginal ? 'Viewing: Original (nearest-scaled for comparison)' : 'Viewing: Upscaled result'}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', fontFamily: 'var(--font-mono)' }}>
                  {tool.upscaleDims
                    ? `${tool.upscaleDims.w}×${tool.upscaleDims.h} → ${tool.upscaleDims.ow}×${tool.upscaleDims.oh} (${Math.round(tool.upscaleDims.ow / tool.upscaleDims.w)}×)`
                    : 'Idle, load or drop an image'}
                </span>
              </div>
            </div>

            {/* Viewport canvas. Accepts drag & drop */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={tool.handleUpscaleDrop}
              className="preview-area"
            >
              {!tool.upscaleUrl ? (
                <NoImageLoaded
                  icon={<Maximize2 size={40} className="icon-dim" />}
                  hint="Drop a pixel-art image here, or browse for one."
                  onChoose={tool.handleSelectUpscaleFile}
                />
              ) : (
                // imageRendering: pixelated. Without it the browser's smooth
                // downscale blurs the crisp result, defeating the whole tool
                <canvas
                  ref={tool.upscalePreviewCanvasRef}
                  style={{
                    width: '100%',
                    height: '100%',
                    maxWidth: '520px',
                    maxHeight: '520px',
                    objectFit: 'contain',
                    imageRendering: 'pixelated',
                    background: 'var(--color-background)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
                  }}
                />
              )}
            </div>

            {/* Export trigger */}
            {tool.upscalePath && tool.upscaleUrl && (
              <div className="panel">
                <div className="row-between">
                  <div className="col-2px">
                    <span className="text-item-bold">Export Upscaled</span>
                    <span className="text-caption">
                      Saves upscaled texture next to original image with an upscaled suffix.
                    </span>
                  </div>
                  <button
                    onClick={tool.handleUpscaleExport}
                    disabled={tool.isUpscaleSaving}
                    style={{
                      background: 'var(--color-secondary)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-inverted)',
                      fontWeight: 'var(--weight-semibold)',
                      padding: '10px 20px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      opacity: tool.isUpscaleSaving ? 0.7 : 1,
                    }}
                  >
                    {tool.isUpscaleSaving ? (
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

                {tool.upscaleExportedPath && (
                  <div style={{
                    background: 'var(--color-success-muted)',
                    border: '1px solid rgba(0, 255, 128, 0.2)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: '11px',
                    color: 'var(--color-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px'
                  }}>
                    <div className="row-6px">
                      <CheckCircle size={13} />
                      <strong>Upscaled successfully saved!</strong>
                    </div>
                    <span className="text-nano">Saved Path: {tool.upscaleExportedPath}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
  )
}
