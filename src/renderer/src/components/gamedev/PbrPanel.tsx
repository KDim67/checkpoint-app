import React from 'react'
import { Box, CheckCircle, Download, Loader, RefreshCw, Settings, Sparkles } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { PbrTool } from './usePbrTool'

/** Shared by every map tile, so the sizing is fixed in one place. */
const MAP_MEDIA: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  display: 'block'
}

/**
 * One map in the grid. There are five, and they differed only by their label
 * and whether they draw into an image or a canvas.
 */
function MapPreview({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      background: 'var(--color-surface-1)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3)'
    }}>
      <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      {/* Square, and sized from the column it sits in. The box used to be a
          grid row stretched to the full height of the panel while the map
          inside it was capped at 160px, which left each map adrift in the
          middle of a mostly empty rectangle. */}
      <div style={{
        aspectRatio: '1',
        background: 'var(--color-background)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      }}>
        {children}
      </div>
    </div>
  )
}

export default function PbrPanel({ tool, onCardDone }: { tool: PbrTool; onCardDone: (cardId: string) => Promise<void> }) {
  const {
    setAlbedoPath,
    setAlbedoUrl,
    setExportedFiles,
    preloadCardId,
    albedoPath,
    albedoUrl,
    isProcessing,
    isSaving,
    exportedFiles,
    shape,
    setShape,
    rotate,
    setRotate,
    normalIntensity,
    setNormalIntensity,
    heightDepth,
    setHeightDepth,
    roughnessContrast,
    setRoughnessContrast,
    roughnessBase,
    setRoughnessBase,
    aoIntensity,
    setAoIntensity,
    invertHeight,
    setInvertHeight,
    heightCanvasRef,
    normalCanvasRef,
    roughnessCanvasRef,
    aoCanvasRef,
    previewCanvasRef,
    handlePbrDragOver,
    handlePbrDrop,
    handleBrowseClick,
    handleExport
  } = tool

  return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
        <div className="gamedev-info-banner">
          <Sparkles size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>PBR Map Generator:</strong> Drag and drop a flat Albedo texture to automatically estimate and generate corresponding Normal, Height, Roughness, and Ambient Occlusion (AO) maps. Tweak parameters and preview in real time on a 3D model.
          </div>
        </div>

        {!albedoUrl ? (
          /* Drop Zone */
          <div
            onDragOver={handlePbrDragOver}
            onDrop={handlePbrDrop}
            onClick={handleBrowseClick}
            style={{
              // Not flex: 1. The drop target grew to whatever height was
              // going, which on a tall window left a nine hundred pixel dashed
              // box with a small label adrift in the middle of it.
              minHeight: '260px',
              maxHeight: '420px',
              border: '2px dashed var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-4)',
              cursor: 'pointer',
              background: 'var(--color-surface-1)',
              transition: 'border-color var(--duration-fast), background var(--duration-fast)',
            }}
            onMouseOver={e => {
              e.currentTarget.style.borderColor = 'var(--color-primary)'
              e.currentTarget.style.background = 'var(--color-surface-2)'
            }}
            onMouseOut={e => {
              e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
              e.currentTarget.style.background = 'var(--color-surface-1)'
            }}
          >
            {isProcessing ? (
              <>
                <Loader size={32} className="animate-spin" style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Processing texture...</span>
              </>
            ) : (
              <>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-surface-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--color-surface-offset)'
                }}>
                  <Download size={24} style={{ color: 'var(--color-text-muted)', transform: 'rotate(180deg)' }} />
                </div>
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                    Drag & Drop Albedo Texture
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    or click to browse local files (.png, .jpg, .jpeg, .tga, .bmp)
                  </span>
                  {/* What comes back. An empty drop target says what to put in
                      and never said what you get out. */}
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', marginTop: 'var(--space-2)' }}>
                    Returns Normal, Height, Roughness and Ambient Occlusion, previewed on a 3D model
                  </span>
                </div>
              </>
            )}
          </div>
        ) : (
          /* Generator Workspace */
          <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
            
            {/* Left Column: 3D Preview & Sliders */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              overflowY: 'auto'
            }}>
              {/* ThreeJS Container */}
              <div style={{ position: 'relative', width: '100%', height: '300px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-surface-offset)' }}>
                <canvas ref={previewCanvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                
                {/* Floating Controls */}
                <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => setShape(prev => prev === 'sphere' ? 'cube' : prev === 'cube' ? 'plane' : 'sphere')}
                    title="Cycle preview mesh: sphere → cube → plane"
                    style={{
                      background: 'var(--color-surface-1)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-base)',
                      padding: '4px 8px',
                      fontSize: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      backdropFilter: 'blur(4px)'
                    }}
                  >
                    <Box size={10} />
                    <span style={{ textTransform: 'capitalize' }}>{shape}</span>
                  </button>
                  
                  <button
                    onClick={() => setRotate(prev => !prev)}
                    style={{
                      background: 'var(--color-surface-1)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-sm)',
                      color: rotate ? 'var(--color-secondary)' : 'var(--color-text-base)',
                      padding: '4px 8px',
                      fontSize: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      backdropFilter: 'blur(4px)'
                    }}
                  >
                    <RefreshCw size={10} className={rotate ? 'animate-spin' : ''} />
                    <span>Rotation</span>
                  </button>
                </div>
              </div>

              {/* Sliders Title */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
                <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
                <span className="label-caps">
                  Map Generation Tweak Settings
                </span>
              </div>

              {/* Sliders Container */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                {/* Invert height. Dark pixels read as crevices vs. ridges */}
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Invert Height</span>
                    <span style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>Treat dark pixels as raised instead of recessed</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={invertHeight}
                    onChange={e => setInvertHeight(e.target.checked)}
                    style={{ accentColor: 'var(--color-secondary)' }}
                  />
                </label>

                {/* Normal Intensity */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Normal Intensity</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{normalIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="10.0"
                    step="0.1"
                    value={normalIntensity}
                    onChange={e => setNormalIntensity(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Height Depth */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Height/Bump Depth</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{heightDepth.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="5.0"
                    step="0.05"
                    value={heightDepth}
                    onChange={e => setHeightDepth(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Roughness Contrast */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Roughness Contrast</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{roughnessContrast.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="3.0"
                    step="0.1"
                    value={roughnessContrast}
                    onChange={e => setRoughnessContrast(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Roughness Base */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Roughness Base (Shininess)</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{roughnessBase.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={roughnessBase}
                    onChange={e => setRoughnessBase(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* AO Intensity */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>AO Crevice Darkness</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{aoIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="5.0"
                    step="0.1"
                    value={aoIntensity}
                    onChange={e => setAoIntensity(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>
              </div>
            </div>

            {/* Right Column: 2D Grid & Export Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
              
              {/* File Metadata Header */}
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
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Active Albedo File:</span>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={albedoPath || ''}>
                    {albedoPath ? albedoPath.split(/[\\/]/).pop() : 'Direct Memory'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    onClick={handleBrowseClick}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-base)',
                      fontSize: '11px',
                      padding: '6px 12px',
                      cursor: 'pointer'
                    }}
                  >
                    Change Texture
                  </button>
                  <button
                    onClick={() => {
                      setAlbedoUrl(null)
                      setAlbedoPath(null)
                      setExportedFiles([])
                      useAppStore.getState().setGamedevPreloadTexture(null, null)
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-error-muted)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-error)',
                      fontSize: '11px',
                      padding: '6px 12px',
                      cursor: 'pointer'
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* 2D Previews Grid */}
              <div style={{
                flex: 1,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
                gap: 'var(--space-3)',
                // Rows take the height their contents need. Without this the
                // grid divides the panel between them however tall that is.
                alignContent: 'start',
                overflowY: 'auto'
              }}>
                
                <MapPreview label="Albedo (Base Color)">
                  <img src={albedoUrl || undefined} style={MAP_MEDIA} alt="Albedo" />
                </MapPreview>

                <MapPreview label="Normal Map">
                  <canvas ref={normalCanvasRef} style={MAP_MEDIA} />
                </MapPreview>

                <MapPreview label="Height Map (Displacement)">
                  <canvas ref={heightCanvasRef} style={MAP_MEDIA} />
                </MapPreview>

                <MapPreview label="Roughness Map">
                  <canvas ref={roughnessCanvasRef} style={MAP_MEDIA} />
                </MapPreview>

                <MapPreview label="Ambient Occlusion (AO)">
                  <canvas ref={aoCanvasRef} style={MAP_MEDIA} />
                </MapPreview>
              </div>

              {/* Export Trigger Block */}
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
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export PBR Textures</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      Saves maps next to original file as lossless PNGs.
                    </span>
                  </div>
                  <button
                    onClick={handleExport}
                    disabled={isSaving}
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
                      opacity: isSaving ? 0.7 : 1,
                    }}
                  >
                    {isSaving ? (
                      <>
                        <Loader size={14} className="animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        <span>Export Textures</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Workflow Card Move Prompt */}
                {preloadCardId && exportedFiles.length > 0 && (
                  <div style={{
                    background: 'var(--color-secondary-muted)',
                    border: '1px solid var(--color-secondary)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-3) var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    marginTop: 'var(--space-2)',
                  }}>
                    <div className="row">
                      <CheckCircle size={14} style={{ color: 'var(--color-secondary)' }} />
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                        Maps Saved next to original texture!
                      </span>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>
                      Since you came from a Kanban ticket, would you like to automatically mark it as Done?
                    </p>
                    
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '2px' }}>
                      <button
                        onClick={async () => {
                          await onCardDone(preloadCardId)
                          useAppStore.getState().setGamedevPreloadTexture(null, null)
                        }}
                        style={{
                          background: 'var(--color-secondary)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-inverted)',
                          fontSize: '10px',
                          fontWeight: 'var(--weight-semibold)',
                          padding: '5px 10px',
                          cursor: 'pointer'
                        }}
                      >
                        Yes, Mark Ticket as Done
                      </button>
                      <button
                        onClick={() => {
                          useAppStore.getState().setGamedevPreloadTexture(null, null)
                        }}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-muted)',
                          fontSize: '10px',
                          padding: '5px 10px',
                          cursor: 'pointer'
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
  )
}
