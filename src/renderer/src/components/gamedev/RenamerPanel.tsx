import React from 'react'
import { Info, Trash2, RefreshCw, CheckCircle, Layers } from 'lucide-react'
import type { RenamerTool } from './useRenamerTool'

export default function RenamerPanel({ tool }: { tool: RenamerTool }) {
  const {
    files,
    setFiles,
    renamerPreset,
    setRenamerPreset,
    renamerSuffixPreset,
    setRenamerSuffixPreset,
    searchStr,
    setSearchStr,
    replaceStr,
    setReplaceStr,
    customPrefix,
    setCustomPrefix,
    customSuffix,
    setCustomSuffix,
    enableIndexing,
    setEnableIndexing,
    startIndex,
    setStartIndex,
    indexPadding,
    setIndexPadding,
    renaming,
    isDragOver,
    getNewName,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
    handleApplyRename
  } = tool

  return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
        <div className="gamedev-info-banner">
          <Info size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Batch Asset Renamer:</strong> Standardize your file naming workflow. Import textures, models, or audio assets to apply game engine naming conventions, search-and-replace strings, or automatic number indexing.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 'var(--space-4)' }}>
          
          {/* Settings Card */}
          <div style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)'
          }}>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Naming Conventions</h3>
            
            {/* Preset Row */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Asset Type Prefix (Unity/Unreal)</label>
              <select
                value={renamerPreset}
                onChange={e => setRenamerPreset(e.target.value as any)}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-2)',
                  fontSize: 'var(--text-xs)'
                }}
              >
                <option value="none">No Preset Prefix</option>
                <option value="texture">Texture (T_)</option>
                <option value="mesh">Static Mesh (SM_)</option>
                <option value="audio">Audio (A_)</option>
              </select>
            </div>

            {/* Suffix Preset */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Texture Map Suffix</label>
              <select
                value={renamerSuffixPreset}
                onChange={e => setRenamerSuffixPreset(e.target.value as any)}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-2)',
                  fontSize: 'var(--text-xs)'
                }}
              >
                <option value="none">No Preset Suffix</option>
                <option value="diffuse">Diffuse (_D)</option>
                <option value="normal">Normal map (_N)</option>
              </select>
            </div>

            {/* Custom Prefix & Suffix */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Custom Prefix</label>
                <input
                  type="text"
                  value={customPrefix}
                  onChange={e => setCustomPrefix(e.target.value)}
                  placeholder="e.g. Env_"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    fontSize: 'var(--text-xs)'
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Custom Suffix</label>
                <input
                  type="text"
                  value={customSuffix}
                  onChange={e => setCustomSuffix(e.target.value)}
                  placeholder="e.g. _low"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    fontSize: 'var(--text-xs)'
                  }}
                />
              </div>
            </div>

            {/* Search and Replace */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Search For</label>
                <input
                  type="text"
                  value={searchStr}
                  onChange={e => setSearchStr(e.target.value)}
                  placeholder="e.g. temp"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    fontSize: 'var(--text-xs)'
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Replace With</label>
                <input
                  type="text"
                  value={replaceStr}
                  onChange={e => setReplaceStr(e.target.value)}
                  placeholder="e.g. final"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    fontSize: 'var(--text-xs)'
                  }}
                />
              </div>
            </div>

            {/* Auto Number Indexing */}
            <div style={{
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2.5)',
              background: 'var(--color-surface-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)'
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={enableIndexing}
                  onChange={e => setEnableIndexing(e.target.checked)}
                />
                <span>Automatic Number Indexing</span>
              </label>
              {enableIndexing && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginTop: '2px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Start Index</label>
                    <input
                      type="number"
                      value={startIndex}
                      onChange={e => setStartIndex(Math.max(0, parseInt(e.target.value) || 0))}
                      style={{
                        background: 'var(--color-surface-1)',
                        border: '1px solid var(--color-surface-offset)',
                        color: 'var(--color-text-base)',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        fontSize: '11px'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Digits Padding</label>
                    <input
                      type="number"
                      value={indexPadding}
                      onChange={e => setIndexPadding(Math.max(1, parseInt(e.target.value) || 2))}
                      style={{
                        background: 'var(--color-surface-1)',
                        border: '1px solid var(--color-surface-offset)',
                        color: 'var(--color-text-base)',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        fontSize: '11px'
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Drag Zone Card */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              background: isDragOver ? 'var(--color-primary-muted)' : 'var(--color-surface-1)',
              border: isDragOver ? '2px dashed var(--color-secondary)' : '2px dashed var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '220px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 150ms ease'
            }}
            onClick={() => document.getElementById('renamer-file-picker')?.click()}
          >
            <input
              type="file"
              id="renamer-file-picker"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <Layers size={36} style={{ color: isDragOver ? 'var(--color-secondary)' : 'var(--color-text-faint)', marginBottom: 'var(--space-2)' }} />
            <h4 style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
              Drag & Drop Game Assets Here
            </h4>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', maxWidth: '240px', lineHeight: 1.5 }}>
              Supports models, textures, sound clips. Paths will load securely into preview.
            </p>
            <span style={{ display: 'inline-block', marginTop: 'var(--space-3)', background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: '11px', fontWeight: 'var(--weight-medium)' }}>
              Browse Local Files
            </span>
          </div>
        </div>

        {/* Preview List */}
        {files.length > 0 && (
          <div style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: '200px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <div className="row">
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Renaming Preview ({files.length} items)</span>
                <button
                  onClick={() => setFiles([])}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-error)',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'inline-flex',
                    alignItems: 'center'
                  }}
                  title="Clear Files"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <button
                onClick={handleApplyRename}
                disabled={renaming}
                style={{
                  background: 'var(--color-secondary)',
                  color: 'white',
                  border: 'none',
                  padding: 'var(--space-1.5) var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1-5)',
                  opacity: renaming ? 0.6 : 1
                }}
              >
                <RefreshCw size={12} className={renaming ? 'spin' : ''} />
                <span>Apply Batch Rename</span>
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '300px' }}>
              {files.map((file, idx) => {
                const newName = getNewName(file.name, idx)
                const isChanged = newName !== file.name
                return (
                  <div key={idx} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto 1fr',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-2)',
                    background: 'var(--color-surface-2)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)'
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }} title={file.path}>
                      {file.name}
                    </span>
                    <span style={{ color: 'var(--color-text-faint)' }}>➔</span>
                    <span style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: isChanged ? 'var(--weight-semibold)' : 'var(--weight-normal)',
                      color: isChanged ? 'var(--color-secondary)' : 'var(--color-text-base)'
                    }}>
                      {newName}
                      {file.status === 'success' && <CheckCircle size={12} style={{ color: 'var(--color-success)', marginLeft: '6px', display: 'inline' }} />}
                      {file.status === 'error' && (
                        <span style={{ color: 'var(--color-error)', marginLeft: '6px', fontSize: '10px' }} title={file.error}>
                          ⚠ Fail
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
  )
}
