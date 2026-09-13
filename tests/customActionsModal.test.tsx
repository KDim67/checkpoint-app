// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CustomActionsModal from '../src/renderer/src/components/ai/CustomActionsModal'
import { useCustomActions, type CustomActions } from '../src/renderer/src/components/ai/useCustomActions'
import { getSetting, setSetting } from '../src/renderer/src/data/settings'
import type { CustomAction } from '../src/renderer/src/components/ai/types'

vi.mock('../src/renderer/src/data/settings', () => ({ getSetting: vi.fn(), setSetting: vi.fn(), deleteSetting: vi.fn() }))

type SettingValue = Awaited<ReturnType<typeof getSetting>>

const patchNotes: CustomAction = { id: 'ca_1', label: 'Patch notes', prompt: 'Write patch notes for this week.', intent: 'create' }
const summary: CustomAction = { id: 'ca_2', label: 'Sprint summary', prompt: 'Summarise what shipped.', intent: 'analyze' }

beforeEach(() => {
  vi.mocked(getSetting).mockReset().mockResolvedValue(null as SettingValue)
  vi.mocked(setSetting).mockReset().mockResolvedValue(undefined as Awaited<ReturnType<typeof setSetting>>)
})
afterEach(cleanup)

/** the real list, so what the form adds shows up */
function Library({ onClose }: { onClose: CustomActions['setShowCustomActionsModal'] }) {
  const actions = useCustomActions()
  return <CustomActionsModal actions={{ ...actions, setShowCustomActionsModal: onClose }} />
}

const openLibrary = async (stored: CustomAction[] | null = null) => {
  vi.mocked(getSetting).mockResolvedValue((stored && JSON.stringify(stored)) as SettingValue)
  const onClose = vi.fn<CustomActions['setShowCustomActionsModal']>()
  render(<Library onClose={onClose} />)
  await waitFor(() => expect(getSetting).toHaveBeenCalled())
  return { onClose }
}

describe('CustomActionsModal', () => {
  it('says what the library is for while it is empty', async () => {
    await openLibrary()

    expect(screen.getByText('My Quick Actions (0)')).toBeTruthy()
    expect(screen.getByText(/No custom actions yet/)).toBeTruthy()
  })

  it('lists the saved actions with what each one does', async () => {
    await openLibrary([patchNotes, summary])

    expect(await screen.findByText('Patch notes')).toBeTruthy()
    expect(screen.getByText('My Quick Actions (2)')).toBeTruthy()
    expect(screen.getByText('Creates items')).toBeTruthy()
    expect(screen.getByText('Analyzes')).toBeTruthy()
  })

  it('saves an action only once it has a label and a prompt', async () => {
    await openLibrary()
    const save = screen.getByText('Save Action') as HTMLButtonElement
    const label = screen.getByPlaceholderText('Label (e.g. Write patch notes)') as HTMLInputElement
    expect(save.disabled).toBe(true)

    fireEvent.change(label, { target: { value: 'Release blurb' } })
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('The full prompt to send…'), { target: { value: 'Write a blurb for the release.' } })
    fireEvent.change(screen.getByTitle(/structured board generator/), { target: { value: 'create' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    expect(await screen.findByText('Release blurb')).toBeTruthy()
    expect(screen.getByText('Creates items')).toBeTruthy()
    expect(setSetting).toHaveBeenCalledWith('ai_custom_actions', expect.stringContaining('Release blurb'))
    expect(label.value).toBe('')
  })

  it('deletes an action and saves the list without it', async () => {
    await openLibrary([patchNotes, summary])
    await screen.findByText('Patch notes')

    fireEvent.click(screen.getAllByTitle('Delete action')[0])

    expect(screen.queryByText('Patch notes')).toBeNull()
    expect(setSetting).toHaveBeenCalledWith('ai_custom_actions', JSON.stringify([summary]))
  })

  it('closes from the button in its header', async () => {
    const { onClose } = await openLibrary()
    const close = screen.getByText('My Quick Actions (0)').parentElement?.nextElementSibling
    if (!(close instanceof HTMLButtonElement)) throw new Error('the header button moved')

    fireEvent.click(close)

    expect(onClose).toHaveBeenCalledWith(false)
  })
})
