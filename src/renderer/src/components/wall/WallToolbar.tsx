import { StickyNote, Type, Square, Layers, Image as ImageIcon, Maximize2, Undo2, Redo2, Grid3x3, FileText, Download, PanelRight, PenLine, Spline, MousePointer2 } from 'lucide-react'
import { redo, undo } from '../../../../shared/history'
import WallSwitcher from './WallSwitcher'
import { panHintLabel } from '../../lib/wallInput'
import { toolButton } from './wallButtons'
import WallBackgroundMenu from './WallBackgroundMenu'
import WallSearch from './WallSearch'
import WallShortcutsMenu from './WallShortcutsMenu'
import WallPlacePicker from './WallPlacePicker'
import type { WallViewState } from './useWallView'

export default function WallToolbar({ wallView }: { wallView: WallViewState }) {
  const {
    doc, notes, picker, setPicker, snapping, setSnapping, tool, setTool, arrowFrom, setArrowFrom,
    query, setQuery, wallMenuOpen, setWallMenuOpen, renaming, setRenaming, setPendingDelete,
    railOpen, bgOpen, setBgOpen, shortcutsOpen, setShortcutsOpen, keys, panButtons, menuButton,
    fileInputRef, docRef, historyRef, wallIndex, activeWall, commitIndex, addWall, setBackground,
    toggleRail, setCamera, applyHistory, addItem, placeImageFiles, jumpTo, exportPng, fitToContent,
    camera, custom, pickerRows, labelOf, matches, undoable, redoable
  } = wallView
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      padding: 'var(--space-2) var(--space-3)',
      borderBottom: '1px solid var(--color-surface-offset)',
      flexShrink: 0, position: 'relative'
    }}>
      <WallBackgroundMenu bgOpen={bgOpen} setBgOpen={setBgOpen} custom={custom} setBackground={setBackground} />

      <div className="divider-v" />

      {/* Which wall */}
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
      {toolButton('Draw', <PenLine size={14} />, () => setTool(t => (t === 'pen' ? 'select' : 'pen')), { active: tool === 'pen', shortcut: keys.wall_tool_draw })}
      {toolButton('Connect two items', <Spline size={14} />, () => { setArrowFrom(null); setTool(t => (t === 'arrow' ? 'select' : 'arrow')) }, { active: tool === 'arrow', shortcut: keys.wall_tool_connect })}

      {toolButton('Sticky note', <StickyNote size={14} />, () => addItem('note'))}
      {toolButton('Text', <Type size={14} />, () => addItem('text'))}
      {toolButton('Frame', <Square size={14} />, () => addItem('frame'))}
      {toolButton('Place a card', <Layers size={14} />, () => setPicker(p => (p === 'card' ? null : 'card')))}
      {toolButton('Place a note', <FileText size={14} />, () => setPicker(p => (p === 'doc' ? null : 'doc')))}
      {toolButton('Image', <ImageIcon size={14} />, () => fileInputRef.current?.click())}

      <div className="divider-v" />

      {toolButton('Undo', <Undo2 size={14} />, () => applyHistory(undo(historyRef.current)), { disabled: !undoable })}
      {toolButton('Redo', <Redo2 size={14} />, () => applyHistory(redo(historyRef.current)), { disabled: !redoable })}
      {toolButton('Snap to grid', <Grid3x3 size={14} />, () => setSnapping(v => !v), { active: snapping })}
      {toolButton('Fit to content', <Maximize2 size={14} />, fitToContent, { disabled: doc.items.length === 0 })}
      {toolButton('Export as PNG', <Download size={14} />, () => void exportPng(), { disabled: doc.items.length === 0 })}

      {/* A number you cannot act on is a label pretending to be a control.
          Clicking it is the fastest way back from a zoom you regret. */}
      <button
        onClick={() => setCamera({ ...docRef.current.camera, zoom: 1 })}
        title="Reset zoom to 100%"
        aria-label="Reset zoom to 100 percent"
        disabled={Math.round(camera.zoom * 100) === 100}
        style={{
          fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)',
          minWidth: '46px', height: '24px', padding: '0 var(--space-1)',
          background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
          cursor: Math.round(camera.zoom * 100) === 100 ? 'default' : 'pointer'
        }}
      >
        {Math.round(camera.zoom * 100)}%
      </button>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', position: 'relative' }}>
        {/* Says what the armed tool does rather than everything at once. The
            old line wrapped to two rows and was ignored either way. */}
        <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
          {tool === 'pen'
            ? 'Drag to draw · Esc to stop'
            : tool === 'arrow'
              ? (arrowFrom ? 'Now click the item to point at' : 'Drag from one item to another, or to anywhere')
              : `Drag to select · Space or ${panHintLabel(panButtons)} to pan`}
        </span>

        <WallSearch query={query} setQuery={setQuery} matches={matches} jumpTo={jumpTo} labelOf={labelOf} />

        <WallShortcutsMenu
          shortcutsOpen={shortcutsOpen}
          setShortcutsOpen={setShortcutsOpen}
          keys={keys}
          panButtons={panButtons}
          menuButton={menuButton}
        />

        {/* At this end because the panel it opens is on this side. It used
            to sit on the far left, pointing across the whole toolbar. */}
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
