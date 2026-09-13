import type { Dispatch, SetStateAction } from 'react'
import { Paintbrush } from 'lucide-react'
import { WALL_COLORS } from '../../../../shared/wallModel'
import WallColorPicker from './WallColorPicker'
import { toolButton } from './wallButtons'

interface WallBackgroundMenuProps {
  bgOpen: boolean
  setBgOpen: Dispatch<SetStateAction<boolean>>
  custom: string | null
  setBackground: (background: string) => void
}

export default function WallBackgroundMenu({
  bgOpen, setBgOpen, custom, setBackground
}: WallBackgroundMenuProps) {
  return (
    <div data-wall-popover="bg" className="relative">
      {toolButton('Wall background', <Paintbrush size={14} />, () => setBgOpen(v => !v), { active: bgOpen })}

      {bgOpen && (
        <>
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 41,
              padding: 'var(--space-2)', width: '188px',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
            }}
          >
            <WallColorPicker
              colors={WALL_COLORS}
              value={custom ?? undefined}
              onChange={setBackground}
              columns={4}
              defaultLabel="Follow the theme"
              onDefault={() => { setBackground('default'); setBgOpen(false) }}
            />
          </div>
        </>
      )}
    </div>
  )
}
