import React from 'react'
import { CheckCircle, Download, Loader, Repeat, Settings } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { SeamlessTool } from './useSeamlessTool'
import TextureDropZone from './TextureDropZone'
import ActiveTextureHeader from './ActiveTextureHeader'

export default function SeamlessPanel({ tool, onCardDone }: { tool: SeamlessTool; onCardDone: (cardId: string) => Promise<void> }) {
  return (
      <div className="col-lg-full">
        <div className="gamedev-info-banner">
          <Repeat size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Seamless Texture Generator:</strong> Convert any non-tiling texture into an infinitely repeating seamless material. Adjust the blend width and stitch edges seamlessly using edge mirror or linear/bilinear feathering overlaps.
          </div>
        </div>

        {!tool.seamlessUrl ? (
          /* Drop Zone */
          <TextureDropZone
            onDragOver={tool.handleSeamlessDragOver}
            onDrop={tool.handleSeamlessDrop}
            onClick={tool.handleSeamlessBrowseClick}
            processing={tool.isSeamlessProcessing}
            label="Drag & Drop Base Texture"
          />
        ) : (
          /* Seamless Workspace */
          <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
            
            {/* Left Column: Tweak Sliders */}
            <div className="panel-scroll">
              {/* Settings Title */}
              <div className="section-head">
                <Settings size={14} className="text-muted" />
                <span className="label-caps">
                  Stitching Configuration
                </span>
              </div>

              {/* Sliders Container */}
              <div className="col-md">
                
                {/* Algorithm Toggle */}
                <div className="col-6px">
                  <span className="text-label-sm">
                    Blending Algorithm
                  </span>
                  <div style={{ display: 'flex', gap: '4px', background: 'var(--color-background)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
                    <button
                      onClick={() => tool.setSeamlessAlgorithm('mirror')}
                      style={{
                        flex: 1,
                        background: tool.seamlessAlgorithm === 'mirror' ? 'var(--color-surface-2)' : 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: tool.seamlessAlgorithm === 'mirror' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                        padding: '6px',
                        fontSize: '11px',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'pointer'
                      }}
                    >
                      Mirror Edges
                    </button>
                    <button
                      onClick={() => tool.setSeamlessAlgorithm('feather')}
                      style={{
                        flex: 1,
                        background: tool.seamlessAlgorithm === 'feather' ? 'var(--color-surface-2)' : 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: tool.seamlessAlgorithm === 'feather' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
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
                {tool.seamlessAlgorithm === 'feather' && (
                  <div className="col-4px-mt">
                    <div className="row-caption">
                      <span className="text-label">Blend/Overlap Width</span>
                      <span className="text-accent">{Math.round(tool.seamlessBlendWidth * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.40"
                      step="0.01"
                      value={tool.seamlessBlendWidth}
                      onChange={e => { tool.setSeamlessBlendWidth(parseFloat(e.target.value)); tool.updateSeamlessPreviewDebounced() }}
                      className="range-full"
                    />
                  </div>
                )}

                {/* Luminance Equalizer */}
                <div className="col-4px-mt">
                  <div className="row-caption">
                    <span className="text-label">Luminance Equalizer</span>
                    <span className="text-accent">{Math.round(tool.seamlessEqualizer * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={tool.seamlessEqualizer}
                    onChange={e => { tool.setSeamlessEqualizer(parseFloat(e.target.value)); tool.updateSeamlessPreviewDebounced() }}
                    className="range-full"
                  />
                </div>

                {/* Wavy Seams (only if feathering is selected) */}
                {tool.seamlessAlgorithm === 'feather' && (
                  <div className="col-4px-mt">
                    <div className="row-caption">
                      <span className="text-label">Wavy Seams (Mask Warping)</span>
                      <span className="text-accent">{Math.round(tool.seamlessWavySeams * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={tool.seamlessWavySeams}
                      onChange={e => { tool.setSeamlessWavySeams(parseFloat(e.target.value)); tool.updateSeamlessPreviewDebounced() }}
                      className="range-full"
                    />
                  </div>
                )}

                {/* Tiling Grid Scale */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'var(--space-2)' }}>
                  <span className="text-label-sm">
                    Preview Repetition Scale
                  </span>
                  <div style={{ display: 'flex', gap: '4px', background: 'var(--color-background)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
                    {([2, 3, 4] as const).map(scale => (
                      <button
                        key={scale}
                        onClick={() => tool.setSeamlessTilingScale(scale)}
                        style={{
                          flex: 1,
                          background: tool.seamlessTilingScale === scale ? 'var(--color-surface-2)' : 'transparent',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          color: tool.seamlessTilingScale === scale ? 'var(--color-secondary)' : 'var(--color-text-muted)',
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
                  <span className="text-label-sm">
                    Show Tiling Grid Lines
                  </span>
                  <input
                    type="checkbox"
                    checked={tool.seamlessShowGrid}
                    onChange={e => tool.setSeamlessShowGrid(e.target.checked)}
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
            <div className="col-lg-min">
              
              {/* Metadata Header */}
              <ActiveTextureHeader
                label="Active Asset:"
                path={tool.seamlessPath}
                onChange={tool.handleSeamlessBrowseClick}
                onClear={() => {
                  tool.setSeamlessUrl(null)
                  tool.setSeamlessPath(null)
                  tool.setSeamlessExportedFile(null)
                  useAppStore.getState().setGamedevPreloadSeamless(null, null)
                }}
              />

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
                    onClick={() => tool.setSeamlessShowOriginal(false)}
                    style={{
                      padding: '4px 12px',
                      fontSize: '10px',
                      fontWeight: 'var(--weight-semibold)',
                      borderRadius: 'calc(var(--radius-sm) - 1px)',
                      border: 'none',
                      cursor: 'pointer',
                      background: !tool.seamlessShowOriginal ? 'var(--color-primary)' : 'transparent',
                      color: !tool.seamlessShowOriginal ? 'var(--color-on-accent)' : 'var(--color-text-muted)'
                    }}
                  >
                    Result
                  </button>
                  <button
                    onClick={() => tool.setSeamlessShowOriginal(true)}
                    style={{
                      padding: '4px 12px',
                      fontSize: '10px',
                      fontWeight: 'var(--weight-semibold)',
                      borderRadius: 'calc(var(--radius-sm) - 1px)',
                      border: 'none',
                      cursor: 'pointer',
                      background: tool.seamlessShowOriginal ? 'var(--color-surface-2)' : 'transparent',
                      color: tool.seamlessShowOriginal ? 'var(--color-text-base)' : 'var(--color-text-muted)'
                    }}
                  >
                    Original
                  </button>
                </div>
                <canvas ref={tool.seamlessTilingCanvasRef} style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '500px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
              </div>

              {/* Export Trigger Block */}
              <div className="panel">
                <div className="row-between">
                  <div className="col-2px">
                    <span className="text-item-bold">Export Seamless Texture</span>
                    <span className="text-caption">
                      Saves file next to original image with a _seamless suffix.
                    </span>
                  </div>
                  <button
                    onClick={tool.handleSeamlessExport}
                    disabled={tool.isSeamlessSaving}
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
                      opacity: tool.isSeamlessSaving ? 0.7 : 1,
                    }}
                  >
                    {tool.isSeamlessSaving ? (
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
                {tool.preloadSeamlessCardId && tool.seamlessExportedFile && (
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
                        Seamless texture saved next to original!
                      </span>
                    </div>
                    <p className="text-caption-flush">
                      Since you came from a Kanban ticket, would you like to automatically mark it as Done?
                    </p>
                    
                    <div className="flex-gap-mt2">
                      <button
                        onClick={async () => {
                          const cardId = tool.preloadSeamlessCardId
                          if (!cardId) return
                          await onCardDone(cardId)
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
