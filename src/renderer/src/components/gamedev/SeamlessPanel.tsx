import React from 'react'
import { CheckCircle, Download, Loader, Repeat, Settings } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { SeamlessTool } from './useSeamlessTool'
import TextureDropZone from './TextureDropZone'

export default function SeamlessPanel({ tool, onCardDone }: { tool: SeamlessTool; onCardDone: (cardId: string) => Promise<void> }) {
  const {
    setSeamlessPath,
    setSeamlessUrl,
    setSeamlessExportedFile,
    updateSeamlessPreviewDebounced,
    preloadSeamlessCardId,
    seamlessPath,
    seamlessUrl,
    seamlessBlendWidth,
    setSeamlessBlendWidth,
    seamlessAlgorithm,
    setSeamlessAlgorithm,
    seamlessTilingScale,
    setSeamlessTilingScale,
    seamlessEqualizer,
    setSeamlessEqualizer,
    seamlessWavySeams,
    setSeamlessWavySeams,
    isSeamlessProcessing,
    isSeamlessSaving,
    seamlessShowGrid,
    setSeamlessShowGrid,
    seamlessExportedFile,
    seamlessShowOriginal,
    setSeamlessShowOriginal,
    seamlessTilingCanvasRef,
    handleSeamlessExport,
    handleSeamlessDragOver,
    handleSeamlessDrop,
    handleSeamlessBrowseClick
  } = tool

  return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
        <div className="gamedev-info-banner">
          <Repeat size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Seamless Texture Generator:</strong> Convert any non-tiling texture into an infinitely repeating seamless material. Adjust the blend width and stitch edges seamlessly using edge mirror or linear/bilinear feathering overlaps.
          </div>
        </div>

        {!seamlessUrl ? (
          /* Drop Zone */
          <TextureDropZone
            onDragOver={handleSeamlessDragOver}
            onDrop={handleSeamlessDrop}
            onClick={handleSeamlessBrowseClick}
            processing={isSeamlessProcessing}
            label="Drag & Drop Base Texture"
          />
        ) : (
          /* Seamless Workspace */
          <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
            
            {/* Left Column: Tweak Sliders */}
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
              {/* Settings Title */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
                <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
                <span className="label-caps">
                  Stitching Configuration
                </span>
              </div>

              {/* Sliders Container */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                
                {/* Algorithm Toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                    Blending Algorithm
                  </span>
                  <div style={{ display: 'flex', gap: '4px', background: 'var(--color-background)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
                    <button
                      onClick={() => setSeamlessAlgorithm('mirror')}
                      style={{
                        flex: 1,
                        background: seamlessAlgorithm === 'mirror' ? 'var(--color-surface-2)' : 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: seamlessAlgorithm === 'mirror' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                        padding: '6px',
                        fontSize: '11px',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'pointer'
                      }}
                    >
                      Mirror Edges
                    </button>
                    <button
                      onClick={() => setSeamlessAlgorithm('feather')}
                      style={{
                        flex: 1,
                        background: seamlessAlgorithm === 'feather' ? 'var(--color-surface-2)' : 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: seamlessAlgorithm === 'feather' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                        padding: '6px',
                        fontSize: '11px',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'pointer'
                      }}
                    >
                      Feather / Overlap
                    </button>
                  </div>
                </div>

                {/* Blend Width (only if feathering is selected) */}
                {seamlessAlgorithm === 'feather' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                      <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Blend/Overlap Width</span>
                      <span style={{ color: 'var(--color-secondary)' }}>{Math.round(seamlessBlendWidth * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.40"
                      step="0.01"
                      value={seamlessBlendWidth}
                      onChange={e => { setSeamlessBlendWidth(parseFloat(e.target.value)); updateSeamlessPreviewDebounced() }}
                      style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                    />
                  </div>
                )}

                {/* Luminance Equalizer */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Luminance Equalizer</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{Math.round(seamlessEqualizer * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={seamlessEqualizer}
                    onChange={e => { setSeamlessEqualizer(parseFloat(e.target.value)); updateSeamlessPreviewDebounced() }}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Wavy Seams (only if feathering is selected) */}
                {seamlessAlgorithm === 'feather' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                      <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Wavy Seams (Mask Warping)</span>
                      <span style={{ color: 'var(--color-secondary)' }}>{Math.round(seamlessWavySeams * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={seamlessWavySeams}
                      onChange={e => { setSeamlessWavySeams(parseFloat(e.target.value)); updateSeamlessPreviewDebounced() }}
                      style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                    />
                  </div>
                )}

                {/* Tiling Grid Scale */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'var(--space-2)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                    Preview Repetition Scale
                  </span>
                  <div style={{ display: 'flex', gap: '4px', background: 'var(--color-background)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
                    {([2, 3, 4] as const).map(scale => (
                      <button
                        key={scale}
                        onClick={() => setSeamlessTilingScale(scale)}
                        style={{
                          flex: 1,
                          background: seamlessTilingScale === scale ? 'var(--color-surface-2)' : 'transparent',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          color: seamlessTilingScale === scale ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                          padding: '6px',
                          fontSize: '11px',
                          fontWeight: 'var(--weight-semibold)',
                          cursor: 'pointer'
                        }}
                      >
                        {scale}x{scale}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Show Grid Helper Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-2)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                    Show Tiling Grid Lines
                  </span>
                  <input
                    type="checkbox"
                    checked={seamlessShowGrid}
                    onChange={e => setSeamlessShowGrid(e.target.checked)}
                    style={{
                      width: '14px',
                      height: '14px',
                      accentColor: 'var(--color-primary)',
                      cursor: 'pointer'
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Right Column: 3x3 Canvas Grid & Export */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
              
              {/* Metadata Header */}
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
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Active Asset:</span>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={seamlessPath || ''}>
                    {seamlessPath ? seamlessPath.split(/[\\/]/).pop() : 'Direct Memory'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    onClick={handleSeamlessBrowseClick}
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
                      setSeamlessUrl(null)
                      setSeamlessPath(null)
                      setSeamlessExportedFile(null)
                      useAppStore.getState().setGamedevPreloadSeamless(null, null)
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

              {/* 3x3 repeating preview grid with before/after compare toggle */}
              <div style={{
                flex: 1,
                background: 'var(--color-background)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-surface-offset)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 'var(--space-4)',
                overflow: 'hidden',
                gap: 'var(--space-2)'
              }}>
                {/* Before / After Compare Toggle */}
                <div style={{ display: 'flex', gap: '4px', alignSelf: 'center', background: 'var(--color-surface-1)', padding: '3px', borderRadius: 'var(--radius-sm)' }}>
                  <button
                    onClick={() => setSeamlessShowOriginal(false)}
                    style={{
                      padding: '4px 12px',
                      fontSize: '10px',
                      fontWeight: 'var(--weight-semibold)',
                      borderRadius: 'calc(var(--radius-sm) - 1px)',
                      border: 'none',
                      cursor: 'pointer',
                      background: !seamlessShowOriginal ? 'var(--color-primary)' : 'transparent',
                      color: !seamlessShowOriginal ? 'var(--color-on-accent)' : 'var(--color-text-muted)'
                    }}
                  >
                    Result
                  </button>
                  <button
                    onClick={() => setSeamlessShowOriginal(true)}
                    style={{
                      padding: '4px 12px',
                      fontSize: '10px',
                      fontWeight: 'var(--weight-semibold)',
                      borderRadius: 'calc(var(--radius-sm) - 1px)',
                      border: 'none',
                      cursor: 'pointer',
                      background: seamlessShowOriginal ? 'var(--color-surface-2)' : 'transparent',
                      color: seamlessShowOriginal ? 'var(--color-text-base)' : 'var(--color-text-muted)'
                    }}
                  >
                    Original
                  </button>
                </div>
                <canvas ref={seamlessTilingCanvasRef} style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '500px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
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
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export Seamless Texture</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      Saves file next to original image with a _seamless suffix.
                    </span>
                  </div>
                  <button
                    onClick={handleSeamlessExport}
                    disabled={isSeamlessSaving}
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
                      opacity: isSeamlessSaving ? 0.7 : 1,
                    }}
                  >
                    {isSeamlessSaving ? (
                      <>
                        <Loader size={14} className="animate-spin" />
                        <span>Exporting...</span>
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        <span>Export Texture</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Kanban Card Ticket Done Prompt */}
                {preloadSeamlessCardId && seamlessExportedFile && (
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
                        Seamless texture saved next to original!
                      </span>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>
                      Since you came from a Kanban ticket, would you like to automatically mark it as Done?
                    </p>
                    
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '2px' }}>
                      <button
                        onClick={async () => {
                          await onCardDone(preloadSeamlessCardId)
                          useAppStore.getState().setGamedevPreloadSeamless(null, null)
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
                          useAppStore.getState().setGamedevPreloadSeamless(null, null)
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
