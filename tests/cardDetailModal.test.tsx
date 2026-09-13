// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CardDetailModal from '../src/renderer/src/components/kanban/CardDetailModal'
import { readItems } from '../src/renderer/src/data/items'
import { getRelations } from '../src/renderer/src/data/relations'
import { listTags } from '../src/renderer/src/data/tags'
import type { Item } from '../src/shared/types'

vi.mock('../src/renderer/src/data/items', () => ({ readItems: vi.fn(), searchItems: vi.fn() }))
vi.mock('../src/renderer/src/data/relations', () => ({ getRelations: vi.fn(), createRelation: vi.fn(), deleteRelation: vi.fn() }))
vi.mock('../src/renderer/src/data/tags', () => ({ listTags: vi.fn(), createTag: vi.fn(), deleteTag: vi.fn(), recolourTag: vi.fn() }))
vi.mock('../src/renderer/src/data/settings', () => ({ getSetting: vi.fn(async () => null), setSetting: vi.fn(async () => {}) }))
vi.mock('../src/renderer/src/data/app', () => ({ osUserName: () => 'dimitris', getPathForFile: () => '' }))
// Rewind reads focus sessions, the tracker, the clipboard and git. It never
// settling keeps it out of the way.
vi.mock('../src/renderer/src/lib/rewind', () => ({ loadRewind: () => new Promise(() => {}) }))

beforeEach(() => {
  vi.mocked(readItems).mockReset()
  vi.mocked(getRelations).mockReset().mockResolvedValue([])
  vi.mocked(listTags).mockReset().mockResolvedValue([])
})
afterEach(cleanup)

type Props = Parameters<typeof CardDetailModal>[0]
type UpdateMock = ReturnType<typeof vi.fn<Props['onUpdate']>>

const CARD_ID = 'card-0001-abcd'
const columns = [{ id: 'todo', name: 'To Do' }, { id: 'review', name: 'In Review' }]
const card = (metadata = '{}'): Item => ({
  id: CARD_ID, type: 'card', context: 'default', title: 'Draft the release notes', body: '', status: 'todo',
  priority: 0, position: 0, created_at: 0, updated_at: 0, due_at: null, metadata
} as Item)

const openCard = async (overrides: Partial<Props> = {}) => {
  const onUpdate = vi.fn<Props['onUpdate']>(async () => {})
  const onClose = vi.fn<Props['onClose']>()
  render(<CardDetailModal cardId={CARD_ID} initialCard={card()} columns={columns} onUpdate={onUpdate} onClose={onClose} {...overrides} />)
  await screen.findByPlaceholderText('Enter card title...')
  return { onUpdate, onClose }
}

const titleField = () => screen.getByPlaceholderText('Enter card title...') as HTMLInputElement
const saveButton = () => screen.queryByTitle('Save changes (Ctrl+S)')
const pressCtrlS = () => act(async () => { fireEvent.keyDown(window, { key: 's', ctrlKey: true }) })
/** The metadata one write carried, or null when it carried none. */
const metadataOf = (onUpdate: UpdateMock, call: number) =>
  JSON.parse(onUpdate.mock.calls.at(call)?.[1].metadata ?? 'null')

describe('CardDetailModal', () => {
  it('offers Save only once something changed, and writes the title trimmed with a history entry', async () => {
    const { onUpdate } = await openCard()
    expect(saveButton()).toBeNull()
    expect(screen.getByTitle('Close')).toBeTruthy()

    fireEvent.change(titleField(), { target: { value: '  Publish the release notes  ' } })
    expect(screen.getByTitle('Close and discard the unsaved changes')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByTitle('Save changes (Ctrl+S)')) })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const [id, patch] = onUpdate.mock.calls[0]
    expect(id).toBe(CARD_ID)
    expect(patch.title).toBe('Publish the release notes')
    expect(JSON.stringify(metadataOf(onUpdate, 0).activities)).toContain('dimitris')
    await waitFor(() => expect(saveButton()).toBeNull())
    expect(titleField().value).toBe('Publish the release notes')
  })

  it('saves with Ctrl+S and names the column a card moved to', async () => {
    const { onUpdate } = await openCard()

    fireEvent.change(screen.getByDisplayValue('To Do'), { target: { value: 'review' } })
    await pressCtrlS()

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][1].status).toBe('review')
    expect(JSON.stringify(metadataOf(onUpdate, 0).activities)).toContain('In Review')
  })

  it('does nothing on Ctrl+S when there is nothing to save', async () => {
    const { onUpdate } = await openCard()

    await pressCtrlS()

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('writes a comment at once without carrying an unsaved template flag with it', async () => {
    const { onUpdate } = await openCard()

    fireEvent.click(screen.getByLabelText('Mark as Template'))
    fireEvent.change(screen.getByPlaceholderText('Write a comment...'), { target: { value: 'Looks good' } })
    await act(async () => { fireEvent.click(screen.getByText('Save Comment')) })

    const written = onUpdate.mock.calls.map((_, call) => metadataOf(onUpdate, call))
    expect(written.some(meta => meta?.comments?.[0]?.text === 'Looks good')).toBe(true)
    expect(written.every(meta => meta?.isTemplate === undefined)).toBe(true)
    // The flag is still a draft, so the card still has something to save.
    expect(saveButton()).toBeTruthy()
  })

  it('records a checklist tick as it happens', async () => {
    const checklist = [{ id: 'k1', text: 'Write the changelog', done: false }]
    const { onUpdate } = await openCard({ initialCard: card(JSON.stringify({ checklist })) })
    expect(screen.getByText('0 of 1 tasks completed')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByLabelText('Write the changelog')) })

    expect(screen.getByText('1 of 1 tasks completed')).toBeTruthy()
    expect(metadataOf(onUpdate, -1).checklist[0].done).toBe(true)
  })

  it('does not write from a read-only board, even from the keyboard', async () => {
    const { onUpdate } = await openCard({ isReadOnly: true })
    expect(screen.getByText(/spectate mode/)).toBeTruthy()

    fireEvent.change(titleField(), { target: { value: 'Something else' } })
    await pressCtrlS()

    expect(onUpdate).not.toHaveBeenCalled()
    expect(saveButton()).toBeNull()
  })

  it('reads the card from the workspace when it was not handed one', async () => {
    vi.mocked(readItems).mockResolvedValue([card()])

    await openCard({ initialCard: undefined })

    expect(readItems).toHaveBeenCalledWith('default', 'card')
    expect(titleField().value).toBe('Draft the release notes')
  })

  it('closes when the card is no longer there', async () => {
    vi.mocked(readItems).mockResolvedValue([])
    const onClose = vi.fn<Props['onClose']>()

    render(<CardDetailModal cardId="gone" columns={columns} onUpdate={vi.fn<Props['onUpdate']>()} onClose={onClose} />)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
