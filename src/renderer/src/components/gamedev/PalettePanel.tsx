import React from 'react'
import { Info, Copy, Plus } from 'lucide-react'
import ColorPicker from '../ui/ColorPicker'
import type { PaletteTool } from './usePaletteTool'

export default function PalettePanel({
  tool,
  onCopy
}: {
  tool: PaletteTool
  onCopy: (text: string, label: string) => void
}) {
  const copyToClipboard = onCopy

  return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
    <div className="gamedev-info-banner">
      <Info size={15} className="gamedev-info-banner-icon" />
      <div>
        <strong>Shader Palette & Code Generator:</strong> Build clean color schemes and immediately generate array codes for Unity C#, Unreal Engine C++, or HLSL pixel shaders.
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 'var(--space-4)' }}>
    
    {/* Color picker list */}
    <div style={{
      background: 'var(--color-surface-1)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }}>
      <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Color Palette Creator</h3>
      
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <ColorPicker
          value={tool.newColor}
          onCommit={tool.setNewColor}
          swatchSize={32}
          hexInputWidth={100}
          title="Select Palette Color"
        />
        <button
          onClick={tool.addColorToPalette}
          style={{
            background: 'var(--color-secondary)',
            color: 'var(--color-text-inverted)',
            border: 'none',
            padding: 'var(--space-1.5) var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Plus size={14} />
          <span>Add Color</span>
        </button>
      </div>

      {/* Grid of colors */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(70px, 100%), 1fr))', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        {tool.paletteColors.map((col) => (
          <div
            key={col}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              padding: '4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'relative'
            }}
          >
            <div style={{
              width: '100%',
              height: '36px',
              background: col,
              borderRadius: '4px',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
            }} />
            <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', marginTop: '4px', color: 'var(--color-text-muted)' }}>
              {col.toUpperCase()}
            </span>
            <button
              onClick={() => tool.removeColorFromPalette(col)}
              style={{
                position: 'absolute',
                top: '2px',
                right: '2px',
                background: 'rgba(0,0,0,0.5)',
                border: 'none',
                color: 'white',
                borderRadius: '50%',
                width: '14px',
                height: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                cursor: 'pointer'
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>

    {/* Generated Code Snippets */}
    <div style={{
      background: 'var(--color-surface-1)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }}>
      <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Shader & Code Snippets</h3>
      
      {/* Unity Code Block */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div className="row-between">
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-semibold)' }}>Unity C# Color Array</span>
          <button
            onClick={() => copyToClipboard(`public Color[] palette = new Color[] {\n  ${tool.generatedUnityColor}\n};`, 'Unity C#')}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '2px' }}
          >
            <Copy size={10} /> Copy
          </button>
        </div>
        <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', fontSize: '10px', color: 'var(--color-text-muted)', overflowX: 'auto', fontFamily: 'var(--font-mono)' }}>
          {`public Color[] palette = new Color[] {\n  ${tool.generatedUnityColor.substring(0, 80)}...\n};`}
        </pre>
      </div>

      {/* Unreal Code Block */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
        <div className="row-between">
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-semibold)' }}>Unreal Engine C++ FLinearColor</span>
          <button
            onClick={() => copyToClipboard(`TArray<FLinearColor> Palette = {\n  ${tool.generatedUnrealColor}\n};`, 'Unreal C++')}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '2px' }}
          >
            <Copy size={10} /> Copy
          </button>
        </div>
        <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', fontSize: '10px', color: 'var(--color-text-muted)', overflowX: 'auto', fontFamily: 'var(--font-mono)' }}>
          {`TArray<FLinearColor> Palette = {\n  ${tool.generatedUnrealColor.substring(0, 80)}...\n};`}
        </pre>
      </div>

      {/* HLSL Code Block */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
        <div className="row-between">
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-semibold)' }}>HLSL float4 Shader Array</span>
          <button
            onClick={() => copyToClipboard(tool.generatedHlslColor, 'HLSL float4')}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '2px' }}
          >
            <Copy size={10} /> Copy
          </button>
        </div>
        <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', fontSize: '10px', color: 'var(--color-text-muted)', overflowX: 'auto', fontFamily: 'var(--font-mono)' }}>
          {tool.generatedHlslColor.substring(0, 100) + '...'}
        </pre>
      </div>
    </div>
  </div>
  </div>
  )
}
