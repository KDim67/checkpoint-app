import React from 'react'
import type { AtlasMaxSize } from './types'
import { AlertTriangle, Box, CheckCircle, Download, Grid, Loader, Settings } from 'lucide-react'
import type { AtlasTool } from './useAtlasTool'
import FilePickerButton from './FilePickerButton'

export default function AtlasPanel({ tool }: { tool: AtlasTool }) {
  return (
      <div className="col-lg-full">
        <div className="gamedev-info-banner">
          <Grid size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Atlas Forge:</strong> Mathematically pack loose sprite sheets and UI assets into highly-optimized texture atlases. Select a directory containing loose PNG assets, tweak spacing, and automatically trim alpha borders.
          </div>
        </div>

        <div className="tool-layout">
          {/* left: packing config */}
          <div className="panel-scroll">
            <div className="section-head">
              <Settings size={14} className="text-muted" />
              <span className="label-caps">
                Packer Settings
              </span>
            </div>

            <div className="col-6px">
              <span className="text-label-sm">
                Source Directory
              </span>
              <FilePickerButton
                onClick={tool.handleSelectAtlasFolder}
                path={tool.atlasFolderPath}
                placeholder="Choose a Folder..."
              />
              {tool.atlasFolderPath && (
                <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', overflowWrap: 'break-word' }}>
                  Path: {tool.atlasFolderPath}
                </span>
              )}
            </div>

            <div className="col-md">
              <div className="col-4px">
                <div className="row-caption">
                  <span className="text-label">Border Padding</span>
                  <span className="text-accent">{tool.atlasPadding}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="32"
                  step="1"
                  value={tool.atlasPadding}
                  onChange={e => tool.setAtlasPadding(parseInt(e.target.value))}
                  className="range-full"
                />
              </div>

              <div className="col-4px">
                <span className="text-label-sm">
                  Max Atlas Size
                </span>
                <select
                  value={tool.atlasMaxSize}
                  onChange={e => tool.setAtlasMaxSize(parseInt(e.target.value) as AtlasMaxSize)}
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
                  <option value={1024}>1024 x 1024</option>
                  <option value={2048}>2048 x 2048</option>
                  <option value={4096}>4096 x 4096</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
                <div className="col-2px">
                  <span className="text-label-sm">Auto-Trim Transparency</span>
                  <span className="text-nano">Cuts out bounding alpha borders</span>
                </div>
                <input
                  type="checkbox"
                  checked={tool.atlasAutoTrim}
                  onChange={e => tool.setAtlasAutoTrim(e.target.checked)}
                  style={{
                    width: '14px',
                    height: '14px',
                    accentColor: 'var(--color-primary)',
                    cursor: 'pointer'
                  }}
                />
              </div>
            </div>

            {/* reality-check warnings */}
            {tool.atlasSprites.length > 150 && (
              <div style={{
                background: 'var(--color-warning-muted)',
                border: '1px solid rgba(255, 170, 0, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-3)',
                fontSize: '10px',
                color: 'var(--color-warning)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                lineHeight: '1.4'
              }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  High Sprite Count Warning: Packing {tool.atlasSprites.length} textures. Chrome is capped at 200 loose frames to prevent memory exhaustion.
                </span>
              </div>
            )}
          </div>

          {/* right: packing preview */}
          <div className="col-lg-min">
            <div className="panel-row">
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span className="text-caption">Atlas Status:</span>
                <span className="text-label-xs">
                  {tool.atlasFolderPath ? `${tool.atlasSprites.length} Sprites Loaded` : 'Idle - Please choose folder'}
                </span>
              </div>
              {tool.atlasLayout && (
                <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: '11px' }}>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)', marginRight: '4px' }}>Packed Dimensions:</span>
                    <span style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-secondary)' }}>{tool.atlasLayout.size} x {tool.atlasLayout.size} px</span>
                  </div>
                </div>
              )}
            </div>

            <div className="preview-area">
              {!tool.atlasFolderPath ? (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Box size={40} className="icon-dim" />
                  <div className="col-2px">
                    <span className="text-item-bold">No Folder Selected</span>
                    <span className="text-hint">Select a folder of loose sprites to begin forging the atlas.</span>
                  </div>
                  <button
                    onClick={tool.handleSelectAtlasFolder}
                    style={{
                      background: 'var(--color-primary)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      color: 'white',
                      fontWeight: 'var(--weight-semibold)',
                      fontSize: 'var(--text-xs)',
                      padding: '10px 20px',
                      cursor: 'pointer',
                    }}
                  >
                    Choose Folder
                  </button>
                </div>
              ) : tool.isAtlasPacking ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Loader size={32} className="animate-spin text-accent" />
                  <span className="text-hint">Calculating optimum packing layout...</span>
                </div>
              ) : (
                <canvas ref={tool.atlasPreviewCanvasRef} style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '500px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
              )}
            </div>

            {tool.atlasFolderPath && tool.atlasLayout && (
              <div className="panel">
                <div className="row-between">
                  <div className="col-2px">
                    <span className="text-item-bold">Export Atlas & Metadata</span>
                    <span className="text-caption">
                      Saves atlas.png and atlas.json directly inside the sprite folder.
                    </span>
                  </div>
                  <button
                    onClick={tool.handleAtlasExport}
                    disabled={tool.isAtlasSaving}
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
                      opacity: tool.isAtlasSaving ? 0.7 : 1,
                    }}
                  >
                    {tool.isAtlasSaving ? (
                      <>
                        <Loader size={14} className="animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        <span>Export Sprite Atlas</span>
                      </>
                    )}
                  </button>
                </div>

                {tool.atlasExportedPng && (
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
                      <strong>Atlas generated successfully!</strong>
                    </div>
                    <span className="text-nano">PNG Path: {tool.atlasExportedPng}</span>
                    <span className="text-nano">JSON Path: {tool.atlasExportedJson}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
  )
}
