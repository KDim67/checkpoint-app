import React, { useState, useCallback, useEffect } from 'react'
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
import { getStringSetting, setStringSetting } from '../lib/settings'
import { findTool } from './gamedev/toolCatalogue'
import GameDevLauncher from './gamedev/GameDevLauncher'
import ToolSwitcher from './gamedev/ToolSwitcher'
import { updateItem } from '../data/items'

const RECENT_KEY = 'gamedev_recent_tools'
/** covers a session's switching without becoming a second menu */
const RECENT_MAX = 4

export default function GameDevView() {
  const { toast } = useToast()
  const activeTab = useAppStore(s => s.gamedevActiveTab)
  const setActiveTab = useAppStore(s => s.setGamedevActiveTab)
  const [recent, setRecent] = useState<GameDevTab[]>([])

  useEffect(() => {
    void getStringSetting(RECENT_KEY, '').then(raw => {
      // drop ids of tools that no longer exist instead of blank cards
      setRecent(raw.split(',').filter(id => findTool(id as GameDevTab)) as GameDevTab[])
    })
  }, [])

  /** the launcher costs a click, so recently used tools float up */
  const openTool = useCallback((id: GameDevTab) => {
    setActiveTab(id)
    setRecent(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, RECENT_MAX)
      void setStringSetting(RECENT_KEY, next.join(','))
      return next
    })
  }, [setActiveTab])

  const paletteTool = usePaletteTool()
  const renamerTool = useRenamerTool()
  const slicerTool = useSlicerTool()
  const atlasTool = useAtlasTool()
  const upscalerTool = useUpscalerTool(activeTab === 'upscaler')
      const dialogueTool = useDialogueTool(useCallback(() => setActiveTab('dialogue'), [setActiveTab]))
  const seamlessTool = useSeamlessTool(
    activeTab === 'seamless',
    useCallback(() => setActiveTab('seamless'), [setActiveTab])
  )
  const pbrTool = usePbrTool(activeTab === 'pbr', useCallback(() => setActiveTab('pbr'), [setActiveTab]))

  // the grader writes next to whatever asset a sibling tool has open
  const lutTool = useLutTool(
    activeTab === 'lut',
    slicerTool.slicerPath || seamlessTool.seamlessPath || pbrTool.albedoPath || upscalerTool.upscalePath
  )

  const moveCardToDone = useCallback(async (cardId: string) => {
    try {
      const activeWorkspace = useAppStore.getState().activeWorkspace
      // unified board doc, the legacy column key stopped being written
      const { columns } = await loadBoardConfig(activeWorkspace)
      const doneCol = columns.find(c => c.id === 'done' || c.name.toLowerCase().includes('done'))
      const doneColId = doneCol?.id ?? 'done'
      await updateItem(cardId, { status: doneColId })
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
{activeTab && <ToolSwitcher activeTab={activeTab} onPick={openTool} onHome={() => setActiveTab(null)} />}

      {!activeTab && <GameDevLauncher onPick={openTool} recent={recent} />}

      <div style={{ flex: 1, minHeight: 0 }}>
        
        {activeTab === 'renamer' && (
          <RenamerPanel tool={renamerTool} />
        )}

        {activeTab === 'dialogue' && (
          <DialoguePanel tool={dialogueTool} onCopy={copyToClipboard} />
        )}

        {activeTab === 'palette' && (
          <PalettePanel tool={paletteTool} onCopy={copyToClipboard} />
        )}

        {activeTab === 'pbr' && (
          <PbrPanel tool={pbrTool} onCardDone={moveCardToDone} />
        )}

        {activeTab === 'seamless' && (
          <SeamlessPanel tool={seamlessTool} onCardDone={moveCardToDone} />
        )}

        {activeTab === 'atlas' && (
          <AtlasPanel tool={atlasTool} />
        )}

        {activeTab === 'slicer' && (
          <SlicerPanel tool={slicerTool} />
        )}

        {activeTab === 'lut' && (
          <LutPanel tool={lutTool} />
        )}

        {activeTab === 'upscaler' && (
          <UpscalerPanel tool={upscalerTool} />
        )}

      </div>
    </div>
  )
}
