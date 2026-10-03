// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../src/renderer/src/lib/settings', () => ({
  getBoolSetting: vi.fn(async (_key: string, fallback: boolean) => fallback),
  getStringSetting: vi.fn(async (_key: string, fallback: string) => fallback),
  setStringSetting: vi.fn(async () => {})
}))
vi.mock('../src/renderer/src/data/sync', () => ({
  onSyncProgress: () => () => {}, getStatus: vi.fn(async () => ({ syncing: false })), triggerSync: vi.fn(async () => {})
}))

import { Sidebar } from '../src/renderer/src/components/Sidebar'

afterEach(cleanup)

describe('the sidebar labels', () => {
  it('name the view and the key that goes there, on hover and on keyboard focus', async () => {
    await act(async () => { render(<Sidebar />) })
    const wall = screen.getByLabelText('Wall')

    fireEvent.mouseEnter(wall)
    expect(screen.getByText('Ctrl+6')).toBeTruthy()
    fireEvent.mouseLeave(wall)
    expect(screen.queryByText('Ctrl+6')).toBeNull()

    fireEvent.focus(wall)
    expect(screen.getByText('Ctrl+6')).toBeTruthy()
  })
})
