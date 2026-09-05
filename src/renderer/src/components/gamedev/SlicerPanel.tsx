import React from 'react'
import { AlertTriangle, CheckCircle, Download, Loader, Plus, Scissors, Settings } from 'lucide-react'
import type { SlicerTool } from './useSlicerTool'

export default function SlicerPanel({ tool }: { tool: SlicerTool }) {
  const {
    slicerPath,
    slicerUrl,
    sliceMode,
    setSliceMode,
    sliceCellW,
    setSliceCellW,
    sliceCellH,
    setSliceCellH,
    slicedFrames,
    isSlicerProcessing,
    isSlicerSaving,
    slicerExportedCount,
    slicerPreviewCanvasRef,
    slicerDims,
    handleSelectSlicerFile,
    handleSlicerExport
  } = tool

  return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
        <div className="gamedev-info-banner">
          <Scissors size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Sprite Slicer:</strong> Dissect large composite texture sheets into separate frames. Choose between a uniform pixel grid or auto-slicing (pixel island clustering).
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
                Slicing Settings
              </span>
            </div>

            {/* File input button */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                Sprite Sheet Image
              </span>
              <button
                onClick={handleSelectSlicerFile}
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
                  {slicerPath ? slicerPath.split(/[\\/]/).pop() : 'Load Texture...'}
                </span>
                <Plus size={14} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
              </button>
            </div>

            {/* Slicing mode selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                Slicing Mode
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', background: 'var(--color-background)', padding: '2px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-surface-offset)' }}>
                <button
                  onClick={() => setSliceMode('grid')}
                  style={{
                    background: sliceMode === 'grid' ? 'var(--color-surface-offset)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: sliceMode === 'grid' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                    fontSize: '11px',
                    padding: '6px',
                    cursor: 'pointer',
                    fontWeight: sliceMode === 'grid' ? 'var(--weight-bold)' : 'var(--weight-normal)'
                  }}
                >
                  Uniform Grid
                </button>
                <button
                  onClick={() => setSliceMode('auto')}
                  style={{
                    background: sliceMode === 'auto' ? 'var(--color-surface-offset)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: sliceMode === 'auto' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                    fontSize: '11px',
                    padding: '6px',
                    cursor: 'pointer',
                    fontWeight: sliceMode === 'auto' ? 'var(--weight-bold)' : 'var(--weight-normal)'
                  }}
                >
                  Pixel Islands
                </button>
              </div>
            </div>

            {/* Grid Slicing inputs */}
            {sliceMode === 'grid' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Cell Width (px)</span>
                  <input
                    type="number"
                    value={sliceCellW}
                    onChange={e => setSliceCellW(Math.max(4, parseInt(e.target.value) || 32))}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-base)',
                      fontSize: 'var(--text-xs)',
                      padding: '8px',
                      outline: 'none'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Cell Height (px)</span>
                  <input
                    type="number"
                    value={sliceCellH}
                    onChange={e => setSliceCellH(Math.max(4, parseInt(e.target.value) || 32))}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-base)',
                      fontSize: 'var(--text-xs)',
                      padding: '8px',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right Canvas Column */}
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
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Slicer Status:</span>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                  {slicerPath ? `${slicedFrames.length} Slices Identified` : 'Idle - Please load image'}
                </span>
                {slicerPath && sliceMode === 'grid' && slicerDims && (slicerDims.w % sliceCellW > 0 || slicerDims.h % sliceCellH > 0) && (
                  <span style={{ fontSize: '10px', color: 'var(--color-warning)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertTriangle size={11} />
                    {slicerDims.w % sliceCellW}px width, {slicerDims.h % sliceCellH}px height remainder discarded.
                  </span>
                )}
              </div>
            </div>

            {/* Preview Canvas Area */}
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
              {!slicerUrl ? (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Scissors size={40} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>No Image Loaded</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Choose a composite texture or grid sheet to partition.</span>
                  </div>
                  <button
                    onClick={handleSelectSlicerFile}
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
                    Choose Image
                  </button>
                </div>
              ) : isSlicerProcessing ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Loader size={32} className="animate-spin" style={{ color: 'var(--color-secondary)' }} />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Slicing texture regions...</span>
                </div>
              ) : (
                <canvas ref={slicerPreviewCanvasRef} style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '500px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
              )}
            </div>

            {/* Sliced Export Trigger */}
            {slicerPath && slicedFrames.length > 0 && (
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
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export Slices</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      Saves individual sliced PNG files directly to the directory of the original sheet.
                    </span>
                  </div>
                  <button
                    onClick={handleSlicerExport}
                    disabled={isSlicerSaving}
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
                      opacity: isSlicerSaving ? 0.7 : 1,
                    }}
                  >
                    {isSlicerSaving ? (
                      <>
                        <Loader size={14} className="animate-spin" />
                        <span>Exporting...</span>
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        <span>Save Slices</span>
                      </>
                    )}
                  </button>
                </div>

                {slicerExportedCount !== null && (
                  <div style={{
                    background: 'rgba(0, 255, 128, 0.05)',
                    border: '1px solid rgba(0, 255, 128, 0.2)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: '11px',
                    color: 'var(--color-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <CheckCircle size={13} />
                    <strong>Successfully sliced and saved {slicerExportedCount} sprites!</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
  )
}
