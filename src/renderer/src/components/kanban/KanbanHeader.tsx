import { Layers, LayoutGrid, Eye } from 'lucide-react'
import type { CardDisplay } from '../../lib/boardConfig'
import MenuItem, { MenuDivider, MenuPanel } from '../ui/MenuItem'
import CollabPanel from './CollabPanel'
import HeaderBtn from './HeaderBtn'
import TemplateMenu from './TemplateMenu'
import BoardThemeMenu from './BoardThemeMenu'
import type { KanbanBoard } from './useKanbanBoard'

/** card face fields a board can toggle */
const CARD_DISPLAY_FIELDS: { key: keyof CardDisplay; label: string }[] = [
  { key: 'priority', label: 'Priority Bar' },
  { key: 'tags', label: 'Tags' },
  { key: 'due', label: 'Due Date' },
  { key: 'bodyPreview', label: 'Body Preview' },
  { key: 'cover', label: 'Cover' },
  { key: 'checklist', label: 'Checklist Progress' },
  { key: 'template', label: 'Template Badge' },
  { key: 'doneCheckbox', label: 'Done Checkbox' }
]

export default function KanbanHeader({ kanbanBoard }: { kanbanBoard: KanbanBoard }) {
  const {
    activeWorkspace, availableWorkspaces, workspaceList, setWorkspace, setView, setSettingsTab,
    dropdownOpen, setDropdownOpen, dropdownRef, cards, swimlanesEnabled, setSwimlanesEnabled,
    cardDisplay, setCardDisplay, showCardDisplayMenu, setShowCardDisplayMenu, cardDisplayRef,
    persistConfig, theme, showArchiveBin, setShowArchiveBin, showTemplateSelector,
    setShowTemplateSelector, collab, handleCreateCardFromTemplate, templateCards
  } = kanbanBoard
  return (
    <header className="kanban-header" style={{
      // min not fixed: a hard 52px let wrapped text spill out
      minHeight: '52px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-3)',
      padding: '0 var(--space-6)',
      borderBottom: '1px solid var(--color-surface-offset)',
      background: 'var(--color-surface-1)',
      flexShrink: 0
    }}>
      {/* minWidth 0 so this side gives way when narrow */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
        <h1 className="kanban-header-title" style={{
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--color-text-base)',
          margin: 0,
          letterSpacing: 'var(--tracking-tight)',
          whiteSpace: 'nowrap',
          flexShrink: 0
        }}>
          Kanban Board
        </h1>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(v => !v)}
            className="bg-surface-2 hover-bg-offset"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-secondary)',
              padding: '2px 10px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--color-surface-offset)',
              cursor: 'pointer',
              fontWeight: 'var(--weight-semibold)',
              transition: 'background var(--duration-fast), border-color var(--duration-fast)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              // truncated, wrapping turned a chip into three lines
              maxWidth: '190px',
              minWidth: 0,
              whiteSpace: 'nowrap'
            }}
          >
            <span className="truncate">
              #{workspaceList.find(c => c.slug === activeWorkspace)?.name || activeWorkspace}
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}>
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {dropdownOpen && (
            <MenuPanel>
              {availableWorkspaces.map(ctx => {
                const entry = workspaceList.find(c => c.slug === ctx)
                const name = entry ? entry.name : ctx.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                const color = entry ? entry.color : 'var(--color-balance)'
                return (
                  <MenuItem
                    key={ctx}
                    active={ctx === activeWorkspace}
                    icon={<span style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: ctx === activeWorkspace ? 'var(--color-secondary)' : color,
                      flexShrink: 0
                    }} />}
                    onClick={() => {
                      setWorkspace(ctx)
                      setDropdownOpen(false)
                    }}
                  >
                    {name}
                  </MenuItem>
                )
              })}
              <MenuDivider />
              <MenuItem
                onClick={() => {
                  setView('settings')
                  setSettingsTab('workspaces')
                  setDropdownOpen(false)
                }}
              >
                New Workspace
              </MenuItem>
            </MenuPanel>
          )}
        </div>
        <span className="kanban-card-count" style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
          whiteSpace: 'nowrap',
          flexShrink: 0
        }}>
          {cards.filter(c => c.status !== 'archived').length} active card{cards.filter(c => c.status !== 'archived').length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* never shrinks, a button past the edge can't be pressed */}
      <div className="row no-shrink">
        <CollabPanel session={collab} />

        <BoardThemeMenu theme={theme} persistConfig={persistConfig} />

        <HeaderBtn
          onClick={() => setShowArchiveBin(true)}
          title="View archived cards and lists"
          icon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="5" x="2" y="3" rx="1"/>
              <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>
            </svg>
          }
          active={showArchiveBin}
        >
          Archive Bin
        </HeaderBtn>

        <HeaderBtn
          active={swimlanesEnabled}
          onClick={async () => {
            const next = !swimlanesEnabled
            setSwimlanesEnabled(next)
            await persistConfig({ swimlanes: next })
          }}
          title="Toggle priority swimlanes"
          icon={swimlanesEnabled ? <Layers size={13} /> : <LayoutGrid size={13} />}
        >
          {swimlanesEnabled ? 'Priority View' : 'Flat Board'}
        </HeaderBtn>

        {/* what each card shows */}
        <div className="relative" ref={cardDisplayRef}>
          <HeaderBtn
            active={showCardDisplayMenu}
            onClick={() => setShowCardDisplayMenu(v => !v)}
            title="Choose what appears on each card"
            icon={<Eye size={13} />}
          >
            Card Fields
          </HeaderBtn>
          {showCardDisplayMenu && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              zIndex: 60,
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              padding: 'var(--space-2)',
              minWidth: '190px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px'
            }}>
              {CARD_DISPLAY_FIELDS.map(field => (
                <label
                  key={field.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-1-5) var(--space-2)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={cardDisplay[field.key]}
                    onChange={e => {
                      const next = { ...cardDisplay, [field.key]: e.target.checked }
                      setCardDisplay(next)
                      persistConfig({ cardDisplay: next })
                    }}
                    style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          )}
        </div>

        {templateCards.length > 0 && (
          <TemplateMenu
            templates={templateCards}
            open={showTemplateSelector}
            setOpen={setShowTemplateSelector}
            onPick={handleCreateCardFromTemplate}
          />
        )}

        {/* add column lives at the end of the column row */}

      </div>
    </header>
  )
}
