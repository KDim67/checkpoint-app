import React from 'react'
import type { AtlasMaxSize } from './types'
import { AlertTriangle, Box, CheckCircle, Download, Grid, Loader, Plus, Settings } from 'lucide-react'
import type { AtlasTool } from './useAtlasTool'

export default function AtlasPanel({ tool }: { tool: AtlasTool }) {
  const {
    atlasFolderPath,
    atlasSprites,
    atlasPadding,
    setAtlasPadding,
    atlasMaxSize,
    setAtlasMaxSize,
    atlasAutoTrim,
    setAtlasAutoTrim,
    isAtlasPacking,
    isAtlasSaving,
    atlasExportedPng,
    atlasExportedJson,
    atlasLayout,
    atlasPreviewCanvasRef,
    handleSelectAtlasFolder,
    handleAtlasExport
  } = tool

  return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
        <div className="gamedev-info-banner">
          <Grid size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Atlas Forge:</strong> Mathematically pack loose sprite sheets and UI assets into highly-optimized texture atlases. Select a directory containing loose PNG assets, tweak spacing, and automatically trim alpha borders.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 'var(--space-4)', minHeight: 0, flex: 1 }}>
          {/* Left Column: Packing Configuration */}
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
            {/* Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
              <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
              <span className="label-caps">
                Packer Settings
              </span>
            </div>

            {/* Directory Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                Source Directory
              </span>
              <button
                onClick={handleSelectAtlasFolder}
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
                  {atlasFolderPath ? atlasFolderPath.split(/[\\/]/).pop() : 'Choose a Folder...'}
                </span>
                <Plus size={14} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
              </button>
              {atlasFolderPath && (
                <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', overflowWrap: 'break-word' }}>
                  Path: {atlasFolderPath}
                </span>
              )}
            </div>

            {/* Sliders and Toggles Container */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Padding Slider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Border Padding</span>
                  <span style={{ color: 'var(--color-secondary)' }}>{atlasPadding}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="32"
                  step="1"
                  value={atlasPadding}
                  onChange={e => setAtlasPadding(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                />
              </div>

              {/* Max Atlas Size Dropdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                  Max Atlas Size
                </span>
                <select
                  value={atlasMaxSize}
                  onChange={e => setAtlasMaxSize(parseInt(e.target.value) as AtlasMaxSize)}
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

              {/* Auto-Trim Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Auto-Trim Transparency</span>
                  <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>Cuts out bounding alpha borders</span>
                </div>
                <input
                  type="checkbox"
                  checked={atlasAutoTrim}
                  onChange={e => setAtlasAutoTrim(e.target.checked)}
                  style={{
                    width: '14px',
                    height: '14px',
                    accentColor: 'var(--color-primary)',
                    cursor: 'pointer'
                  }}
                />
              </div>
            </div>

            {/* Reality Check Warnings */}
            {atlasSprites.length > 150 && (
              <div style={{
                background: 'rgba(255, 170, 0, 0.1)',
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
                  High Sprite Count Warning: Packing {atlasSprites.length} textures. Chrome is capped at 200 loose frames to prevent memory exhaustion.
                </span>
              </div>
            )}
          </div>

          {/* Right Column: 2D Packing Preview Canvas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
            {/* Meta Header */}
            <div style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-3) var(--space-4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Atlas Status:</span>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                  {atlasFolderPath ? `${atlasSprites.length} Sprites Loaded` : 'Idle - Please choose folder'}
                </span>
              </div>
              {atlasLayout && (
                <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: '11px' }}>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)', marginRight: '4px' }}>Packed Dimensions:</span>
                    <span style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-secondary)' }}>{atlasLayout.size} x {atlasLayout.size} px</span>
                  </div>
                </div>
              )}
            </div>

            {/* Canvas Render Area */}
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
              {!atlasFolderPath ? (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Box size={40} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>No Folder Selected</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Select a folder of loose sprites to begin forging the atlas.</span>
                  </div>
                  <button
                    onClick={handleSelectAtlasFolder}
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
              ) : isAtlasPacking ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Loader size={32} className="animate-spin" style={{ color: 'var(--color-secondary)' }} />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Calculating optimum packing layout...</span>
                </div>
              ) : (
                <canvas ref={atlasPreviewCanvasRef} style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '500px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
              )}
            </div>

            {/* Export Trigger Block */}
            {atlasFolderPath && atlasLayout && (
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
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export Atlas & Metadata</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      Saves atlas.png and atlas.json directly inside the sprite folder.
                    </span>
                  </div>
                  <button
                    onClick={handleAtlasExport}
                    disabled={isAtlasSaving}
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
                      opacity: isAtlasSaving ? 0.7 : 1,
                    }}
                  >
                    {isAtlasSaving ? (
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

                {/* Saved file notification info */}
                {atlasExportedPng && (
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
                      <strong>Atlas generated successfully!</strong>
                    </div>
                    <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>PNG Path: {atlasExportedPng}</span>
                    <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>JSON Path: {atlasExportedJson}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
  )
}
