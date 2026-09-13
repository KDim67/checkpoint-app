import React from 'react'
import { CheckCircle, Download, Loader, Settings, Sliders } from 'lucide-react'
import type { LutTool } from './useLutTool'

export default function LutPanel({ tool }: { tool: LutTool }) {
  return (
      <div className="col-lg-full">
        <div className="gamedev-info-banner">
          <Sliders size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>LUT Color Grader:</strong> Real-time color correction editor. Adjust filters and sliders to grade a standard neutral 3D look-up table strip ($256\times16$ pixels), compatible with Unity, Unreal, and Godot.
          </div>
        </div>

        <div className="tool-layout">
          {/* Left Columns Sliders */}
          <div className="panel-scroll">
            <div className="section-head">
              <Settings size={14} className="text-muted" />
              <span className="label-caps">
                Color Adjustments
              </span>
            </div>

            {/* Exposure Slider */}
            <div className="col-4px">
              <div className="row-caption">
                <span className="text-label">Exposure</span>
                <span className="text-accent">{tool.lutExposure > 0 ? `+${tool.lutExposure}` : tool.lutExposure}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={tool.lutExposure}
                onChange={e => tool.setLutExposure(parseInt(e.target.value))}
                className="range-full"
              />
            </div>

            {/* Brightness Slider */}
            <div className="col-4px">
              <div className="row-caption">
                <span className="text-label">Brightness</span>
                <span className="text-accent">{tool.lutBrightness > 0 ? `+${tool.lutBrightness}` : tool.lutBrightness}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={tool.lutBrightness}
                onChange={e => tool.setLutBrightness(parseInt(e.target.value))}
                className="range-full"
              />
            </div>

            {/* Contrast Slider */}
            <div className="col-4px">
              <div className="row-caption">
                <span className="text-label">Contrast</span>
                <span className="text-accent">{tool.lutContrast > 0 ? `+${tool.lutContrast}` : tool.lutContrast}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={tool.lutContrast}
                onChange={e => tool.setLutContrast(parseInt(e.target.value))}
                className="range-full"
              />
            </div>

            {/* Saturation Slider */}
            <div className="col-4px">
              <div className="row-caption">
                <span className="text-label">Saturation</span>
                <span className="text-accent">{tool.lutSaturation > 0 ? `+${tool.lutSaturation}` : tool.lutSaturation}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={tool.lutSaturation}
                onChange={e => tool.setLutSaturation(parseInt(e.target.value))}
                className="range-full"
              />
            </div>

            {/* Temperature Slider */}
            <div className="col-4px">
              <div className="row-caption">
                <span className="text-label">Temperature</span>
                <span className="text-accent">{tool.lutTemperature > 0 ? `Warm (+${tool.lutTemperature})` : tool.lutTemperature < 0 ? `Cool (${tool.lutTemperature})` : 'Neutral'}</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={tool.lutTemperature}
                onChange={e => tool.setLutTemperature(parseInt(e.target.value))}
                className="range-full"
              />
            </div>

            {/* Reset button */}
            <button
              onClick={() => {
                tool.setLutExposure(0)
                tool.setLutBrightness(0)
                tool.setLutContrast(0)
                tool.setLutSaturation(0)
                tool.setLutTemperature(0)
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
          <div className="col-lg-min">
            {/* Meta header */}
            <div className="panel-row">
              <div className="col-2px">
                <span className="text-caption">Grader Viewport:</span>
                <span className="text-label-xs">
                  Color Spectrum (Left) | Demo Scene (Right) | LUT Strip (Bottom)
                </span>
              </div>
            </div>

            {/* Canvas viewport */}
            <div className="preview-area">
              <canvas ref={tool.lutPreviewCanvasRef} style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '272px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
            </div>

            {/* Export LUT Strip */}
            <div className="panel">
              <div className="row-between">
                <div className="col-2px">
                  <span className="text-item-bold">Export LUT Strip</span>
                  <span className="text-caption">
                    Saves standard neutral 3D lut slice strip ($256\times16$ px) next to currently loaded project assets.
                  </span>
                </div>
                <button
                  onClick={tool.handleLutExport}
                  disabled={tool.isLutSaving}
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
                    opacity: tool.isLutSaving ? 0.7 : 1
                  }}
                >
                  {tool.isLutSaving ? (
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

              {tool.lutExportedPath && (
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
                    <strong>LUT generated successfully!</strong>
                  </div>
                  <span className="text-nano">Saved Path: {tool.lutExportedPath}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
  )
}
