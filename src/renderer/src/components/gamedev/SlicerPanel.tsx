import React from 'react'
import { AlertTriangle, CheckCircle, Download, Loader, Scissors } from 'lucide-react'
import type { SlicerTool } from './useSlicerTool'
import FilePickerButton from './FilePickerButton'
import SettingsColumn from './SettingsColumn'
import NoImageLoaded from './NoImageLoaded'

export default function SlicerPanel({ tool }: { tool: SlicerTool }) {
  return (
      <div className="col-lg-full">
        <div className="gamedev-info-banner">
          <Scissors size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Sprite Slicer:</strong> Dissect large composite texture sheets into separate frames. Choose between a uniform pixel grid or auto-slicing (pixel island clustering).
          </div>
        </div>

        <div className="tool-layout">
          <SettingsColumn title="Slicing Settings">

            <div className="col-6px">
              <span className="text-label-sm">
                Sprite Sheet Image
              </span>
              <FilePickerButton
                onClick={tool.handleSelectSlicerFile}
                path={tool.slicerPath}
                placeholder="Load Texture..."
              />
            </div>

            <div className="col-6px">
              <span className="text-label-sm">
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

            {tool.sliceMode === 'grid' && (
              <div className="col-md">
                <div className="col-4px">
                  <span className="text-caption">Cell Width (px)</span>
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
                <div className="col-4px">
                  <span className="text-caption">Cell Height (px)</span>
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

          <div className="col-lg-min">
            <div className="panel-row">
              <div className="col-2px">
                <span className="text-caption">Slicer Status:</span>
                <span className="text-label-xs">
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

            <div className="preview-area">
              {!tool.slicerUrl ? (
                <NoImageLoaded
                  icon={<Scissors size={40} className="icon-dim" />}
                  hint="Choose a composite texture or grid sheet to partition."
                  onChoose={tool.handleSelectSlicerFile}
                />
              ) : tool.isSlicerProcessing ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Loader size={32} className="animate-spin text-accent" />
                  <span className="text-hint">Slicing texture regions...</span>
                </div>
              ) : (
                <canvas ref={tool.slicerPreviewCanvasRef} style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '500px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
              )}
            </div>

            {tool.slicerPath && tool.slicedFrames.length > 0 && (
              <div className="panel">
                <div className="row-between">
                  <div className="col-2px">
                    <span className="text-item-bold">Export Slices</span>
                    <span className="text-caption">
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
