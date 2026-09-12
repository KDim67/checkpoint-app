import React from 'react'
import { AlertTriangle, CheckCircle, Download, Loader, Scissors } from 'lucide-react'
import type { SlicerTool } from './useSlicerTool'
import FilePickerButton from './FilePickerButton'
import SettingsColumn from './SettingsColumn'

export default function SlicerPanel({ tool }: { tool: SlicerTool }) {
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
          <SettingsColumn title="Slicing Settings">

            {/* File input button */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                Sprite Sheet Image
              </span>
              <FilePickerButton
                onClick={tool.handleSelectSlicerFile}
                path={tool.slicerPath}
                placeholder="Load Texture..."
              />
            </div>

            {/* Slicing mode selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                Slicing Mode
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', background: 'var(--color-background)', padding: '2px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-surface-offset)' }}>
                <button
                  onClick={() => tool.setSliceMode('grid')}
                  style={{
                    background: tool.sliceMode === 'grid' ? 'var(--color-surface-offset)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: tool.sliceMode === 'grid' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                    fontSize: '11px',
                    padding: '6px',
                    cursor: 'pointer',
                    fontWeight: tool.sliceMode === 'grid' ? 'var(--weight-bold)' : 'var(--weight-normal)'
                  }}
                >
                  Uniform Grid
                </button>
                <button
                  onClick={() => tool.setSliceMode('auto')}
                  style={{
                    background: tool.sliceMode === 'auto' ? 'var(--color-surface-offset)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: tool.sliceMode === 'auto' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                    fontSize: '11px',
                    padding: '6px',
                    cursor: 'pointer',
                    fontWeight: tool.sliceMode === 'auto' ? 'var(--weight-bold)' : 'var(--weight-normal)'
                  }}
                >
                  Pixel Islands
                </button>
              </div>
            </div>

            {/* Grid Slicing inputs */}
            {tool.sliceMode === 'grid' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Cell Width (px)</span>
                  <input
                    type="number"
                    value={tool.sliceCellW}
                    onChange={e => tool.setSliceCellW(Math.max(4, parseInt(e.target.value) || 32))}
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
                    value={tool.sliceCellH}
                    onChange={e => tool.setSliceCellH(Math.max(4, parseInt(e.target.value) || 32))}
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
          </SettingsColumn>

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
                  {tool.slicerPath ? `${tool.slicedFrames.length} Slices Identified` : 'Idle - Please load image'}
                </span>
                {tool.slicerPath && tool.sliceMode === 'grid' && tool.slicerDims && (tool.slicerDims.w % tool.sliceCellW > 0 || tool.slicerDims.h % tool.sliceCellH > 0) && (
                  <span style={{ fontSize: '10px', color: 'var(--color-warning)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertTriangle size={11} />
                    {tool.slicerDims.w % tool.sliceCellW}px width, {tool.slicerDims.h % tool.sliceCellH}px height remainder discarded.
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
              {!tool.slicerUrl ? (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Scissors size={40} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>No Image Loaded</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Choose a composite texture or grid sheet to partition.</span>
                  </div>
                  <button
                    onClick={tool.handleSelectSlicerFile}
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
              ) : tool.isSlicerProcessing ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Loader size={32} className="animate-spin" style={{ color: 'var(--color-secondary)' }} />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Slicing texture regions...</span>
                </div>
              ) : (
                <canvas ref={tool.slicerPreviewCanvasRef} style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '500px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
              )}
            </div>

            {/* Sliced Export Trigger */}
            {tool.slicerPath && tool.slicedFrames.length > 0 && (
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
                    onClick={tool.handleSlicerExport}
                    disabled={tool.isSlicerSaving}
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
                      opacity: tool.isSlicerSaving ? 0.7 : 1,
                    }}
                  >
                    {tool.isSlicerSaving ? (
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

                {tool.slicerExportedCount !== null && (
                  <div style={{
                    background: 'var(--color-success-muted)',
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
                    <strong>Successfully sliced and saved {tool.slicerExportedCount} sprites!</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
  )
}
