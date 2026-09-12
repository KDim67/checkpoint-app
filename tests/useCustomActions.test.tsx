// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { getSetting, setSetting } from '../src/renderer/src/data/settings'
import { useCustomActions } from '../src/renderer/src/components/ai/useCustomActions'
import type { CustomAction } from '../src/renderer/src/components/ai/types'

vi.mock('../src/renderer/src/data/settings', () => ({ getSetting: vi.fn(), setSetting: vi.fn(), deleteSetting: vi.fn() }))

type SettingValue = Awaited<ReturnType<typeof getSetting>>

const saved: CustomAction = { id: 'ca_1', label: 'Patch notes', prompt: 'Write patch notes for this week.', intent: 'create' }

beforeEach(() => {
  vi.mocked(getSetting).mockReset()
  vi.mocked(setSetting).mockReset().mockResolvedValue(undefined as Awaited<ReturnType<typeof setSetting>>)
})
afterEach(cleanup)

describe('useCustomActions', () => {
  it('loads saved actions and drops any missing a label or a prompt', async () => {
    vi.mocked(getSetting).mockResolvedValue(JSON.stringify([saved, { id: 'ca_2', label: '', prompt: 'x' }, null]) as SettingValue)

    const { result } = renderHook(() => useCustomActions())

    await waitFor(() => expect(result.current.customActions).toEqual([saved]))
  })

  it('adds a trimmed action, saves the list, and clears the form', async () => {
    vi.mocked(getSetting).mockResolvedValue(null as SettingValue)
    const { result } = renderHook(() => useCustomActions())
    await waitFor(() => expect(getSetting).toHaveBeenCalled())

    act(() => {
      result.current.setCaLabel('  Summarise the sprint for the whole team, please  ')
      result.current.setCaPrompt('  Summarise what shipped.  ')
      result.current.setCaIntent('create')
    })
    act(() => result.current.handleAddCustomAction())

    const added = result.current.customActions[0]
    expect(added.label).toBe('Summarise the sprint for the whole team,')
    expect(added.label).toHaveLength(40)
    expect(added.prompt).toBe('Summarise what shipped.')
    expect(added.intent).toBe('create')
    expect(setSetting).toHaveBeenCalledWith('ai_custom_actions', JSON.stringify([added]))
    expect(result.current.caLabel).toBe('')
    expect(result.current.caPrompt).toBe('')
    expect(result.current.caIntent).toBe('analyze')
  })

  it('does not save an action without a prompt', async () => {
    vi.mocked(getSetting).mockResolvedValue(null as SettingValue)
    const { result } = renderHook(() => useCustomActions())
    await waitFor(() => expect(getSetting).toHaveBeenCalled())

    act(() => result.current.setCaLabel('Only a label'))
    act(() => result.current.handleAddCustomAction())

    expect(result.current.customActions).toEqual([])
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('starts empty when the stored list no longer parses', async () => {
    vi.mocked(getSetting).mockResolvedValue('{not json' as SettingValue)

    const { result } = renderHook(() => useCustomActions())
    await waitFor(() => expect(getSetting).toHaveBeenCalled())

    expect(result.current.customActions).toEqual([])
  })
})
