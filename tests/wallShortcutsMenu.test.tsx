// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import WallShortcutsMenu from '../src/renderer/src/components/wall/WallShortcutsMenu'
import type { ShortcutBindings } from '../src/renderer/src/lib/shortcuts'

describe('WallShortcutsMenu', () => {
  it('renders all sections and shortcut rows without duplicate key errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const keys: ShortcutBindings = {
      wall_tool_select: 'V',
      wall_tool_draw: 'P',
      wall_tool_erase: 'E',
      wall_tool_connect: 'C',
      wall_duplicate: 'Ctrl+D',
      wall_delete: 'Delete'
    }

    render(
      <WallShortcutsMenu
        shortcutsOpen={true}
        setShortcutsOpen={() => {}}
        keys={keys}
        panButtons="both"
        menuButton="right"
      />
    )

    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
    expect(screen.getByText('Text')).toBeTruthy()
    expect(screen.getByText('Indent or outdent a list item')).toBeTruthy()
    expect(screen.getByText('Next item beside or below, outside a list')).toBeTruthy()

    const duplicateKeyErrors = errorSpy.mock.calls.filter(call =>
      call.some(arg => typeof arg === 'string' && arg.includes('Encountered two children with the same key'))
    )
    expect(duplicateKeyErrors).toHaveLength(0)

    errorSpy.mockRestore()
  })
})
