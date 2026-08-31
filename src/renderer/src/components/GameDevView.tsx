import React, { useState, useCallback } from 'react'
import { GitFork, Grid, Layers, Maximize2, Palette, Repeat, Scissors, Sliders, Sparkles } from 'lucide-react'
import { useToast } from './ui/Toast'
import { loadBoardConfig } from '../lib/boardConfig'
import { useAppStore } from '../store/appStore'
import PalettePanel from './gamedev/PalettePanel'
import DialoguePanel from './gamedev/DialoguePanel'
import RenamerPanel from './gamedev/RenamerPanel'
import SlicerPanel from './gamedev/SlicerPanel'
import UpscalerPanel from './gamedev/UpscalerPanel'
import LutPanel from './gamedev/LutPanel'
import AtlasPanel from './gamedev/AtlasPanel'
import SeamlessPanel from './gamedev/SeamlessPanel'
import PbrPanel from './gamedev/PbrPanel'
import { usePaletteTool } from './gamedev/usePaletteTool'
import { useDialogueTool } from './gamedev/useDialogueTool'
import { useRenamerTool } from './gamedev/useRenamerTool'
import { useSlicerTool } from './gamedev/useSlicerTool'
import { useUpscalerTool } from './gamedev/useUpscalerTool'
import { useLutTool } from './gamedev/useLutTool'
import { useAtlasTool } from './gamedev/useAtlasTool'
import { useSeamlessTool } from './gamedev/useSeamlessTool'
import { usePbrTool } from './gamedev/usePbrTool'
import type { GameDevTab } from './gamedev/types'

export default function GameDevView() {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<GameDevTab>('pbr')

  const paletteTool = usePaletteTool()
  const renamerTool = useRenamerTool()
  const slicerTool = useSlicerTool()
  const atlasTool = useAtlasTool()
  const upscalerTool = useUpscalerTool(activeTab === 'upscaler')
  const dialogueTool = useDialogueTool(useCallback(() => setActiveTab('dialogue'), []))
  const seamlessTool = useSeamlessTool(
    activeTab === 'seamless',
    useCallback(() => setActiveTab('seamless'), [])
  )
  const pbrTool = usePbrTool(activeTab === 'pbr', useCallback(() => setActiveTab('pbr'), []))

  // The grader writes next to whichever asset a sibling tool has open.
  const lutTool = useLutTool(
    activeTab === 'lut',
    slicerTool.slicerPath || seamlessTool.seamlessPath || pbrTool.albedoPath || upscalerTool.upscalePath
  )

  const moveCardToDone = useCallback(async (cardId: string) => {
    try {
      const activeContext = useAppStore.getState().activeContext
      // Reads the unified board document rather than the legacy column key,
      // which stopped being written once board configuration was unified.
      const { columns } = await loadBoardConfig(activeContext)
      const doneCol = columns.find(c => c.id === 'done' || c.name.toLowerCase().includes('done'))
      const doneColId = doneCol?.id ?? 'done'
      await window.electronAPI.db.updateItem(cardId, { status: doneColId })
      window.dispatchEvent(new CustomEvent('kanban-refresh'))
      toast('Success: Ticket moved to Done!', { type: 'success' })
    } catch (err) {
      console.error('Failed to move card to done:', err)
      toast('Failed to move card to Done', { type: 'error' })
    }
  }, [toast])

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast(`Copied ${label} snippet to clipboard`, { type: 'success' })
  }, [toast])

  return (
    <div style={{
      padding: 'var(--space-6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
      overflowY: 'auto',
      height: '100%',
      backgroundColor: 'var(--color-background)',
      color: 'var(--color-text-base)',
      fontFamily: 'var(--font-sans)',
      boxSizing: 'border-box'
    }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', margin: '0 0 var(--space-1)' }}>
          Game Development Workspace
        </h2>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
          Texture authoring, sprite pipeline and narrative tools, all processing runs locally.
        </p>
      </div>

      {/* Grouped tool navigation */}
      <style>{`
        .gamedev-tab-btn {
          background: transparent;
          border: 1px solid transparent;
          color: var(--color-text-muted);
          font-size: var(--text-xs);
          font-weight: var(--weight-medium);
          padding: 7px 13px;
          border-radius: var(--radius-md);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: var(--space-2);
          white-space: nowrap;
          transition: all 120ms ease;
        }
        .gamedev-tab-btn:hover {
          background: var(--color-surface-2);
          color: var(--color-text-base);
        }
        .gamedev-tab-btn.active {
          background: var(--color-secondary-muted);
          color: var(--color-secondary);
          border-color: var(--color-secondary);
          font-weight: var(--weight-semibold);
          box-shadow: var(--shadow-sm);
        }
        .gamedev-info-banner {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
          padding: 12px 16px;
          background: var(--color-surface-1);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-lg);
          font-size: var(--text-xs);
          line-height: 1.5;
          color: var(--color-text-muted);
          margin-bottom: var(--space-4);
        }
        .gamedev-info-banner strong {
          color: var(--color-text-base);
          font-weight: var(--weight-semibold);
        }
        .gamedev-info-banner-icon {
          color: var(--color-secondary);
          flex-shrink: 0;
          margin-top: 2px;
        }
      `}</style>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {([
          {
            group: 'Textures',
            tools: [
              { id: 'pbr' as const,      label: 'PBR Maps',       icon: <Sparkles size={14} /> },
              { id: 'seamless' as const, label: 'Seamless Tiler', icon: <Repeat size={14} /> },
              { id: 'upscaler' as const, label: 'Pixel Upscaler', icon: <Maximize2 size={14} /> },
              { id: 'lut' as const,      label: 'LUT Grader',     icon: <Sliders size={14} /> }
            ]
          },
          {
            group: 'Sprites',
            tools: [
              { id: 'atlas' as const,  label: 'Atlas Packer',  icon: <Grid size={14} /> },
              { id: 'slicer' as const, label: 'Sprite Slicer', icon: <Scissors size={14} /> }
            ]
          },
          {
            group: 'Pipeline',
            tools: [
              { id: 'renamer' as const,  label: 'Batch Renamer',  icon: <Layers size={14} /> },
              { id: 'dialogue' as const, label: 'Dialogue Flow',  icon: <GitFork size={14} /> },
              { id: 'palette' as const,  label: 'Shader Palette', icon: <Palette size={14} /> }
            ]
          }
        ]).map(section => (
          <div
            key={section.group}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: '6px 8px 8px'
            }}
          >
            <span style={{
              fontSize: '9px',
              fontWeight: 'var(--weight-bold)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: 'var(--color-text-faint)',
              padding: '0 6px'
            }}>
              {section.group}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {section.tools.map(tool => (
                <button
                  key={tool.id}
                  onClick={() => setActiveTab(tool.id)}
                  className={`gamedev-tab-btn ${activeTab === tool.id ? 'active' : ''}`}
                >
                  {tool.icon}
                  <span>{tool.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Tab Panels */}
      <div style={{ flex: 1, minHeight: 0 }}>
        
        {/* TAB 1: BATCH ASSET RENAMER */}
        {activeTab === 'renamer' && (
          <RenamerPanel tool={renamerTool} />
        )}

        {/* TAB 3: DIALOGUE & QUEST TREE BUILDER */}
        {activeTab === 'dialogue' && (
          <DialoguePanel tool={dialogueTool} onCopy={copyToClipboard} />
        )}

        {/* TAB 4: SHADER PALETTE CODE GENERATOR */}
        {activeTab === 'palette' && (
          <PalettePanel tool={paletteTool} onCopy={copyToClipboard} />
        )}

        {/* TAB 5: PBR MAP GENERATOR */}
        {activeTab === 'pbr' && (
          <PbrPanel tool={pbrTool} onCardDone={moveCardToDone} />
        )}

        {/* TAB 6: SEAMLESS TEXTURE GENERATOR */}
        {activeTab === 'seamless' && (
          <SeamlessPanel tool={seamlessTool} onCardDone={moveCardToDone} />
        )}

        {/* TAB 7: ATLAS FORGE (SPRITE PACKER) */}
        {activeTab === 'atlas' && (
          <AtlasPanel tool={atlasTool} />
        )}

        {/* TAB 8: SPRITE SLICER */}
        {activeTab === 'slicer' && (
          <SlicerPanel tool={slicerTool} />
        )}

        {/* TAB 9: LUT COLOR GRADER */}
        {activeTab === 'lut' && (
          <LutPanel tool={lutTool} />
        )}

        {/* TAB 10: PIXEL ART UPSCALER */}
        {activeTab === 'upscaler' && (
          <UpscalerPanel tool={upscalerTool} />
        )}

      </div>
    </div>
  )
}
