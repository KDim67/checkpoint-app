// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const fakeCheatsheets = vi.hoisted(() => [
  { name: 'Git-Cheat-Sheet.pdf', path: '/path/Git-Cheat-Sheet.pdf', size: 1024, mtime: 1000 },
  { name: 'React-Guide.pdf', path: '/path/React-Guide.pdf', size: 2048, mtime: 2000 },
  { name: 'Unity-Shaders.pdf', path: '/path/Unity-Shaders.pdf', size: 4096, mtime: 3000 }
])

vi.mock('../src/renderer/src/data/cheatsheets', () => ({
  list: vi.fn(async () => [...fakeCheatsheets]),
  add: vi.fn(async (p: string) => p),
  remove: vi.fn(async () => true),
  rename: vi.fn(async () => true),
  search: vi.fn(async () => []),
  getText: vi.fn(async () => 'Sample text content'),
  selectFile: vi.fn(async () => null)
}))

vi.mock('../src/renderer/src/data/app', () => ({
  openExternal: vi.fn(),
  openPath: vi.fn(async () => true),
  getPathForFile: vi.fn((file: File) => (file as unknown as { path?: string }).path || '')
}))

vi.mock('../src/renderer/src/lib/settings', () => ({
  getBoolSetting: vi.fn(async () => true),
  getJsonSetting: vi.fn(async () => []),
  setJsonSetting: vi.fn(async () => {})
}))

import CheatsheetsView from '../src/renderer/src/components/CheatsheetsView'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'
import { useAppStore } from '../src/renderer/src/store/appStore'

describe('CheatsheetsView QoL improvements', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState({ pendingCheatsheetName: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('restores the last viewed cheatsheet from localStorage', async () => {
    localStorage.setItem('checkpoint_last_cheatsheet', 'React-Guide.pdf')

    await act(async () => {
      render(
        <ToastProvider>
          <CheatsheetsView />
        </ToastProvider>
      )
    })

    // The heading in the viewer displays the selected cheatsheet base name
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('React-Guide')
  })

  it('consumes pendingCheatsheetName from appStore', async () => {
    useAppStore.setState({ pendingCheatsheetName: 'Unity-Shaders.pdf' })

    await act(async () => {
      render(
        <ToastProvider>
          <CheatsheetsView />
        </ToastProvider>
      )
    })

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Unity-Shaders')
    expect(useAppStore.getState().pendingCheatsheetName).toBeNull()
    expect(localStorage.getItem('checkpoint_last_cheatsheet')).toBe('Unity-Shaders.pdf')
  })

  it('navigates through cheatsheets with arrow keys from search input', async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CheatsheetsView />
        </ToastProvider>
      )
    })

    const searchInput = screen.getByPlaceholderText('Search names & contents…')

    // Press ArrowDown to select first item
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: 'ArrowDown' })
    })

    let heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Unity-Shaders') // Default sort is 'recent', Unity-Shaders has mtime 3000

    // Press ArrowDown again to move to next item
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: 'ArrowDown' })
    })

    heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('React-Guide')

    // Press ArrowUp to move back
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: 'ArrowUp' })
    })

    heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Unity-Shaders')
  })

  it('navigates with arrow keys in list container', async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CheatsheetsView />
        </ToastProvider>
      )
    })

    const listbox = screen.getByRole('listbox')

    await act(async () => {
      fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    })

    let heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Unity-Shaders')

    await act(async () => {
      fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    })

    heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('React-Guide')
  })

  it('calls openPath with the file path when clicking Open Native', async () => {
    const { openPath } = await import('../src/renderer/src/data/app')
    localStorage.setItem('checkpoint_last_cheatsheet', 'Unity-Shaders.pdf')

    await act(async () => {
      render(
        <ToastProvider>
          <CheatsheetsView />
        </ToastProvider>
      )
    })

    const openNativeBtn = screen.getByRole('button', { name: /open native/i })
    await act(async () => {
      fireEvent.click(openNativeBtn)
    })

    expect(openPath).toHaveBeenCalledWith('/path/Unity-Shaders.pdf')
  })
})
