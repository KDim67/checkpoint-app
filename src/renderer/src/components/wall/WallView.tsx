/** dot grid scales with the camera, Fit is always there, cards are references; right-drag pans */

import WallContextMenu from './WallContextMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import WallBoardRail from './WallBoardRail'
import {
  filterGroups, groupCardsByColumn
} from '../../../../shared/wallBoard'
import WallRailHandle from './WallRailHandle'
import { useWallView } from './useWallView'
import WallToolbar from './WallToolbar'
import WallCanvas from './WallCanvas'

export default function WallView() {
  const wallView = useWallView()
  const {
    cards, notes, menu, setMenu, pendingDelete, setPendingDelete, railOpen, railWidth,
    setRailWidth, railTab, setRailTab, railQuery, setRailQuery, columns, dropColumnId, toggleRail,
    confirmDeleteWall, menuEntries, placed
  } = wallView

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete wall"
        message={`Delete "${pendingDelete?.name ?? ''}" and everything on it?`}
        warning="Cards and notes placed on it are only removed from the wall. The originals are untouched."
        confirmText="Delete wall"
        isDestructive
        onConfirm={() => void confirmDeleteWall()}
        onCancel={() => setPendingDelete(null)}
      />

      <WallToolbar wallView={wallView} />

      {/* beside the canvas, so the drag is a straight line */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <WallCanvas wallView={wallView} />

        {railOpen && (
          <>
            <WallRailHandle railWidth={railWidth} setRailWidth={setRailWidth} />

            <WallBoardRail
              width={railWidth}
              tab={railTab}
              onTabChange={setRailTab}
              groups={filterGroups(groupCardsByColumn(cards, columns), railQuery)}
              notes={notes}
              placed={placed}
              query={railQuery}
              onQueryChange={setRailQuery}
              dropColumnId={dropColumnId}
              onClose={toggleRail}
            />
          </>
        )}
      </div>

      {menu && (
        <WallContextMenu x={menu.x} y={menu.y} entries={menuEntries()} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
