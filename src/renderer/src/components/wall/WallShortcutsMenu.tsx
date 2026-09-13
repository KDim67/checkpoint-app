import type { Dispatch, SetStateAction } from 'react'
import { Keyboard } from 'lucide-react'
import type { ShortcutBindings } from '../../lib/shortcuts'
import type { PanButtons, MenuButton } from '../../lib/wallInput'
import { toolButton } from './wallButtons'
import { wallShortcutSections } from './wallShortcutSheet'

interface WallShortcutsMenuProps {
  shortcutsOpen: boolean
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>
  keys: ShortcutBindings
  panButtons: PanButtons
  menuButton: MenuButton
}

export default function WallShortcutsMenu({
  shortcutsOpen, setShortcutsOpen, keys, panButtons, menuButton
}: WallShortcutsMenuProps) {
  return (
    <div data-wall-popover="keys" className="relative">
      {toolButton(
        'Keyboard shortcuts',
        <Keyboard size={14} />,
        () => setShortcutsOpen(v => !v),
        { active: shortcutsOpen }
      )}

      {shortcutsOpen && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 41,
            width: '326px', maxHeight: '62vh', overflowY: 'auto',
            padding: 'var(--space-3)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
          }}
        >
          {wallShortcutSections(keys, panButtons, menuButton).map((section, i) => (
            <div
              key={section.group}
              style={{ marginBottom: i === wallShortcutSections(keys, panButtons, menuButton).length - 1 ? 0 : 'var(--space-3)' }}
            >
              <div style={{
                marginBottom: '2px',
                fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em',
                color: 'var(--color-text-faint)'
              }}>
                {section.group}
              </div>
              {section.rows.map(([keys, what]) => (
                <div key={keys} style={{
                  display: 'flex', alignItems: 'baseline',
                  justifyContent: 'space-between', gap: 'var(--space-3)',
                  padding: '2px 0'
                }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)' }}>
                    {what}
                  </span>
                  <kbd style={{
                    flexShrink: 0, whiteSpace: 'nowrap',
                    padding: '1px 5px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-muted)',
                    fontFamily: 'var(--font-mono)', fontSize: '10px'
                  }}>
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
