// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import BoardThemeMenu from '../src/renderer/src/components/kanban/BoardThemeMenu'
import { useBoardTheme } from '../src/renderer/src/components/kanban/useBoardTheme'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'

afterEach(cleanup)

type PersistConfig = Parameters<typeof BoardThemeMenu>[0]['persistConfig']

/** stands in for the board, which owns and paints the theme */
function Board({ persistConfig }: { persistConfig: PersistConfig }) {
  const theme = useBoardTheme()
  return (
    <>
      <BoardThemeMenu theme={theme} persistConfig={persistConfig} />
      <output aria-label="Board background">{theme.boardBg}</output>
      <button>Somewhere else</button>
    </>
  )
}

const renderBoard = () => {
  const persistConfig = vi.fn<PersistConfig>(async () => {})
  render(<ToastProvider><Board persistConfig={persistConfig} /></ToastProvider>)
  fireEvent.click(screen.getByTitle('Change board background theme'))
  return { persistConfig }
}

describe('BoardThemeMenu', () => {
  it('paints a preset, saves it with the board, and closes', () => {
    const { persistConfig } = renderBoard()

    fireEvent.click(screen.getByText('ocean'))

    expect(screen.getByLabelText('Board background').textContent).toBe('ocean')
    expect(persistConfig).toHaveBeenCalledWith({ background: 'ocean' })
    expect(screen.queryByText('Board Theme')).toBeNull()
  })

  it('closes when the pointer goes down somewhere else', () => {
    renderBoard()
    expect(screen.getByText('Board Theme')).toBeTruthy()

    fireEvent.mouseDown(screen.getByText('Somewhere else'))

    expect(screen.queryByText('Board Theme')).toBeNull()
  })

  it('applies a pasted image link with the whitespace taken off', () => {
    const { persistConfig } = renderBoard()

    fireEvent.click(screen.getByText('Wallpaper'))
    fireEvent.change(screen.getByPlaceholderText('Paste image URL (https://...)'), { target: { value: '  https://example.com/wall.png  ' } })
    fireEvent.click(screen.getByText('Apply Wallpaper'))

    expect(screen.getByLabelText('Board background').textContent).toBe('https://example.com/wall.png')
    expect(persistConfig).toHaveBeenCalledWith({ background: 'https://example.com/wall.png' })
  })
})
