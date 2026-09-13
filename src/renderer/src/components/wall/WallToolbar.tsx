import { StickyNote, Type, Shapes, Square, Layers, Image as ImageIcon, Maximize2, Undo2, Redo2, Grid3x3, FileText, PanelRight, PenLine, Spline, MousePointer2 } from 'lucide-react'
import { redo, undo } from '../../../../shared/history'
import WallSwitcher from './WallSwitcher'
import { panHintLabel } from '../../lib/wallInput'
import { toolButton } from './wallButtons'
import WallBackgroundMenu from './WallBackgroundMenu'
import WallSearch from './WallSearch'
import WallShortcutsMenu from './WallShortcutsMenu'
import WallPlacePicker from './WallPlacePicker'
import WallFramesMenu from './WallFramesMenu'
import WallExportMenu from './WallExportMenu'
import WallBinMenu from './WallBinMenu'
import { isDrawTool, type WallTool } from './wallTools'
import type { WallViewState } from './useWallView'

/** only what the armed tool does */
function toolHint(tool: WallTool, linkPicking: boolean, arrowFrom: string | null, panHint: string): string {
  if (linkPicking) return 'Click the item to link to · Esc to cancel'
  if (tool === 'pen') return 'Drag to draw · Esc to stop'
  if (tool === 'highlighter') return 'Drag to highlight · Esc to stop'
  if (tool === 'eraser') return 'Drag across strokes to erase them · Esc to stop'
  if (tool === 'lasso') return 'Draw a loop around what to select · Esc to stop'
  if (tool === 'arrow') return arrowFrom ? 'Now click the item to point at' : 'Drag from one item to another, or to anywhere'
  return `Drag to select · Space or ${panHint} to pan`
}

export default function WallToolbar({ wallView }: { wallView: WallViewState }) {
  const {
    doc, notes, picker, setPicker, snapping, setSnapping, tool, setTool, arrowFrom, setArrowFrom,
    query, setQuery, searchKind, setSearchKind, wallMenuOpen, setWallMenuOpen, renaming, setRenaming,
    setPendingDelete, railOpen, bgOpen, setBgOpen, shortcutsOpen, setShortcutsOpen, keys, panButtons,
    menuButton, fileInputRef, historyRef, wallIndex, activeWall, commitIndex, addWall, setBackground,
    toggleRail, applyHistory, addItem, placeImageFiles, jumpTo, exportWall, fitToContent, zoomReset,
    camera, custom, pickerRows, labelOf, matches, undoable, redoable, linkPickFor, selectedIds,
    framesOpen, setFramesOpen, exportOpen, setExportOpen, binOpen, setBinOpen, frames, binEntries,
    restoreDeleted, showFrame, startPresenting, setFrameOrder
  } = wallView
  const atFullSize = Math.round(camera.zoom * 100) === 100

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      padding: 'var(--space-2) var(--space-3)',
      borderBottom: '1px solid var(--color-surface-offset)',
      flexShrink: 0, position: 'relative'
    }}>
      <WallBackgroundMenu bgOpen={bgOpen} setBgOpen={setBgOpen} custom={custom} setBackground={setBackground} />

      <div className="divider-v" />

      <WallSwitcher
        wallIndex={wallIndex}
        activeWall={activeWall}
        wallMenuOpen={wallMenuOpen}
        setWallMenuOpen={setWallMenuOpen}
        renaming={renaming}
        setRenaming={setRenaming}
        commitIndex={commitIndex}
        addWall={addWall}
        setPendingDelete={setPendingDelete}
      />

      <div className="divider-v" />

      {toolButton('Select', <MousePointer2 size={14} />, () => setTool('select'), { active: tool === 'select', shortcut: keys.wall_tool_select })}
      {/* one button for the pen family, its panel switches between them */}
      {toolButton('Draw', <PenLine size={14} />, () => setTool(t => (isDrawTool(t) ? 'select' : 'pen')), { active: isDrawTool(tool), shortcut: keys.wall_tool_draw })}
      {toolButton('Connect two items', <Spline size={14} />, () => { setArrowFrom(null); setTool(t => (t === 'arrow' ? 'select' : 'arrow')) }, { active: tool === 'arrow', shortcut: keys.wall_tool_connect })}

      {toolButton('Sticky note', <StickyNote size={14} />, () => addItem('note'))}
      {toolButton('Text', <Type size={14} />, () => addItem('text'))}
      {toolButton('Shape', <Shapes size={14} />, () => addItem('shape'))}
      {toolButton('Frame', <Square size={14} />, () => addItem('frame'))}
      {toolButton('Place a card', <Layers size={14} />, () => setPicker(p => (p === 'card' ? null : 'card')))}
      {toolButton('Place a note', <FileText size={14} />, () => setPicker(p => (p === 'doc' ? null : 'doc')))}
      {toolButton('Image', <ImageIcon size={14} />, () => fileInputRef.current?.click())}

      <div className="divider-v" />

      {toolButton('Undo', <Undo2 size={14} />, () => applyHistory(undo(historyRef.current)), { disabled: !undoable })}
      {toolButton('Redo', <Redo2 size={14} />, () => applyHistory(redo(historyRef.current)), { disabled: !redoable })}
      <WallBinMenu open={binOpen} setOpen={setBinOpen} entries={binEntries} labelOf={labelOf} onRestore={restoreDeleted} />
      {toolButton('Snap to grid', <Grid3x3 size={14} />, () => setSnapping(v => !v), { active: snapping })}
      {toolButton('Fit to content', <Maximize2 size={14} />, fitToContent, { disabled: doc.items.length === 0, shortcut: keys.wall_zoom_fit })}
      <WallFramesMenu
        open={framesOpen}
        setOpen={setFramesOpen}
        frames={frames}
        onShow={frame => showFrame(frame)}
        onPresent={startPresenting}
        onReorder={setFrameOrder}
        customOrder={(doc.frameOrder?.length ?? 0) > 0}
        onResetOrder={() => setFrameOrder(undefined)}
      />
      <WallExportMenu
        open={exportOpen}
        setOpen={setExportOpen}
        hasItems={doc.items.length > 0}
        hasSelection={selectedIds.size > 0}
        frameCount={frames.length}
        onExport={choice => void exportWall({ kind: choice })}
      />

      {/* clickable, it's the fastest way back from a bad zoom */}
      <button
        onClick={zoomReset}
        title={keys.wall_zoom_reset ? `Reset zoom to 100% (${keys.wall_zoom_reset})` : 'Reset zoom to 100%'}
        aria-label="Reset zoom to 100 percent"
        disabled={atFullSize}
        style={{
          fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)',
          minWidth: '46px', height: '24px', padding: '0 var(--space-1)',
          background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
          cursor: atFullSize ? 'default' : 'pointer'
        }}
      >
        {Math.round(camera.zoom * 100)}%
      </button>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', position: 'relative' }}>
        <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
          {toolHint(tool, !!linkPickFor, arrowFrom, panHintLabel(panButtons))}
        </span>

        <WallSearch
          query={query}
          setQuery={setQuery}
          kind={searchKind}
          setKind={setSearchKind}
          matches={matches}
          jumpTo={jumpTo}
          labelOf={labelOf}
        />

        <WallShortcutsMenu
          shortcutsOpen={shortcutsOpen}
          setShortcutsOpen={setShortcutsOpen}
          keys={keys}
          panButtons={panButtons}
          menuButton={menuButton}
        />

        {/* this end, the panel opens on this side */}
        {toolButton(
          railOpen ? 'Hide the board' : 'Show the board beside the wall',
          <PanelRight size={14} />,
          toggleRail,
          { active: railOpen }
        )}
      </div>

      {picker && (
        <WallPlacePicker picker={picker} pickerRows={pickerRows} notes={notes} addItem={addItem} setPicker={setPicker} />
      )}

      <input
        ref={fileInputRef} type="file" accept="image/*" multiple className="is-hidden"
        onChange={e => { void placeImageFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
      />
    </div>
  )
}
