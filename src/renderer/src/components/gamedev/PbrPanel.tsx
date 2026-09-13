import React from 'react'
import { Box, CheckCircle, Download, Loader, RefreshCw, Settings, Sparkles } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { PbrTool } from './usePbrTool'
import TextureDropZone from './TextureDropZone'
import ActiveTextureHeader from './ActiveTextureHeader'

/** one sizing for every map tile */
const MAP_MEDIA: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  display: 'block'
}

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
      <span className="text-caption-strong">
        {label}
      </span>
      {/* square from its column; a stretched grid row left the 160px map adrift */}
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
  return (
      <div className="col-lg-full">
        <div className="gamedev-info-banner">
          <Sparkles size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>PBR Map Generator:</strong> Drag and drop a flat Albedo texture to automatically estimate and generate corresponding Normal, Height, Roughness, and Ambient Occlusion (AO) maps. Tweak parameters and preview in real time on a 3D model.
          </div>
        </div>

        {!tool.albedoUrl ? (
          <TextureDropZone
            onDragOver={tool.handlePbrDragOver}
            onDrop={tool.handlePbrDrop}
            onClick={tool.handleBrowseClick}
            processing={tool.isProcessing}
            label="Drag & Drop Albedo Texture"
            outcome="Returns Normal, Height, Roughness and Ambient Occlusion, previewed on a 3D model"
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
            
            {/* left: 3D preview and sliders */}
            <div className="panel-scroll">
              <div style={{ position: 'relative', width: '100%', height: '300px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-surface-offset)' }}>
                <canvas ref={tool.previewCanvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                
                <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => tool.setShape(prev => prev === 'sphere' ? 'cube' : prev === 'cube' ? 'plane' : 'sphere')}
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
                    <span style={{ textTransform: 'capitalize' }}>{tool.shape}</span>
                  </button>
                  
                  <button
                    onClick={() => tool.setRotate(prev => !prev)}
                    style={{
                      background: 'var(--color-surface-1)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-sm)',
                      color: tool.rotate ? 'var(--color-secondary)' : 'var(--color-text-base)',
                      padding: '4px 8px',
                      fontSize: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      backdropFilter: 'blur(4px)'
                    }}
                  >
                    <RefreshCw size={10} className={tool.rotate ? 'animate-spin' : ''} />
                    <span>Rotation</span>
                  </button>
                </div>
              </div>

              <div className="section-head">
                <Settings size={14} className="text-muted" />
                <span className="label-caps">
                  Map Generation Tweak Settings
                </span>
              </div>

              <div className="col-md">

                {/* invert: dark pixels as crevices or ridges */}
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
                    <span className="text-label-sm">Invert Height</span>
                    <span className="text-nano-faint">Treat dark pixels as raised instead of recessed</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={tool.invertHeight}
                    onChange={e => tool.setInvertHeight(e.target.checked)}
                    style={{ accentColor: 'var(--color-secondary)' }}
                  />
                </label>

                <div className="col-4px">
                  <div className="row-caption">
                    <span className="text-label">Normal Intensity</span>
                    <span className="text-accent">{tool.normalIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="10.0"
                    step="0.1"
                    value={tool.normalIntensity}
                    onChange={e => tool.setNormalIntensity(parseFloat(e.target.value))}
                    className="range-full"
                  />
                </div>

                <div className="col-4px">
                  <div className="row-caption">
                    <span className="text-label">Height/Bump Depth</span>
                    <span className="text-accent">{tool.heightDepth.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="5.0"
                    step="0.05"
                    value={tool.heightDepth}
                    onChange={e => tool.setHeightDepth(parseFloat(e.target.value))}
                    className="range-full"
                  />
                </div>

                <div className="col-4px">
                  <div className="row-caption">
                    <span className="text-label">Roughness Contrast</span>
                    <span className="text-accent">{tool.roughnessContrast.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="3.0"
                    step="0.1"
                    value={tool.roughnessContrast}
                    onChange={e => tool.setRoughnessContrast(parseFloat(e.target.value))}
                    className="range-full"
                  />
                </div>

                <div className="col-4px">
                  <div className="row-caption">
                    <span className="text-label">Roughness Base (Shininess)</span>
                    <span className="text-accent">{tool.roughnessBase.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={tool.roughnessBase}
                    onChange={e => tool.setRoughnessBase(parseFloat(e.target.value))}
                    className="range-full"
                  />
                </div>

                <div className="col-4px">
                  <div className="row-caption">
                    <span className="text-label">AO Crevice Darkness</span>
                    <span className="text-accent">{tool.aoIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="5.0"
                    step="0.1"
                    value={tool.aoIntensity}
                    onChange={e => tool.setAoIntensity(parseFloat(e.target.value))}
                    className="range-full"
                  />
                </div>
              </div>
            </div>

            {/* right: 2D maps and export */}
            <div className="col-lg-min">
              
              <ActiveTextureHeader
                label="Active Albedo File:"
                path={tool.albedoPath}
                onChange={tool.handleBrowseClick}
                onClear={() => {
                  tool.setAlbedoUrl(null)
                  tool.setAlbedoPath(null)
                  tool.setExportedFiles([])
                  useAppStore.getState().setGamedevPreloadTexture(null, null)
                }}
              />

              <div style={{
                flex: 1,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
                gap: 'var(--space-3)',
                // rows take their content height, or the grid splits the panel between them
                alignContent: 'start',
                overflowY: 'auto'
              }}>
                
                <MapPreview label="Albedo (Base Color)">
                  <img src={tool.albedoUrl || undefined} style={MAP_MEDIA} alt="Albedo" />
                </MapPreview>

                <MapPreview label="Normal Map">
                  <canvas ref={tool.normalCanvasRef} style={MAP_MEDIA} />
                </MapPreview>

                <MapPreview label="Height Map (Displacement)">
                  <canvas ref={tool.heightCanvasRef} style={MAP_MEDIA} />
                </MapPreview>

                <MapPreview label="Roughness Map">
                  <canvas ref={tool.roughnessCanvasRef} style={MAP_MEDIA} />
                </MapPreview>

                <MapPreview label="Ambient Occlusion (AO)">
                  <canvas ref={tool.aoCanvasRef} style={MAP_MEDIA} />
                </MapPreview>
              </div>

              <div className="panel">
                <div className="row-between">
                  <div className="col-2px">
                    <span className="text-item-bold">Export PBR Textures</span>
                    <span className="text-caption">
                      Saves maps next to original file as lossless PNGs.
                    </span>
                  </div>
                  <button
                    onClick={tool.handleExport}
                    disabled={tool.isSaving}
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
                      opacity: tool.isSaving ? 0.7 : 1,
                    }}
                  >
                    {tool.isSaving ? (
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

                {/* offer to move the kanban card */}
                {tool.preloadCardId && tool.exportedFiles.length > 0 && (
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
                      <CheckCircle size={14} className="text-accent" />
                      <span className="text-label-xs">
                        Maps Saved next to original texture!
                      </span>
                    </div>
                    <p className="text-caption-flush">
                      Since you came from a Kanban ticket, would you like to automatically mark it as Done?
                    </p>
                    
                    <div className="flex-gap-mt2">
                      <button
                        onClick={async () => {
                          const cardId = tool.preloadCardId
                          if (!cardId) return
                          await onCardDone(cardId)
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
