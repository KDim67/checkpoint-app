// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { UpdateProgress } from '../src/shared/types'

afterEach(cleanup)

/** the bridge as the indicator sees it, with progress pushed in by hand */
async function withProgress(initial: UpdateProgress | null) {
  let push: (p: UpdateProgress | null) => void = () => {}
  const installUpdate = vi.fn(async () => {})
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    app: {
      updateState: async () => initial,
      onUpdateProgress: (cb: (p: UpdateProgress | null) => void) => { push = cb; return () => {} },
      installUpdate
    }
  }
  vi.resetModules()
  const { default: UpdateIndicator } = await import('../src/renderer/src/components/ui/UpdateIndicator')
  const onOpen = vi.fn()
  await act(async () => { render(<UpdateIndicator onOpen={onOpen} />) })
  return { push: (p: UpdateProgress | null) => act(async () => push(p)), installUpdate, onOpen }
}

describe('the update pill in the title bar', () => {
  it('offers the restart once the update is in, and restarts only when clicked', async () => {
    const { installUpdate } = await withProgress({ phase: 'ready', version: '1.2.0' })
    const pill = screen.getByRole('button')
    expect(pill.textContent).toContain('Restart to update')
    expect(installUpdate).not.toHaveBeenCalled()
    fireEvent.click(pill)
    expect(installUpdate).toHaveBeenCalledTimes(1)
  })

  it('goes away when a failed download is cleared', async () => {
    const { push } = await withProgress({ phase: 'downloading', version: '1.2.0', percent: 40, transferred: 4, total: 10, bytesPerSecond: 1 })
    expect(screen.queryByRole('button')).not.toBeNull()
    await push(null)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
