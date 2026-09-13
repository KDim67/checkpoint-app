// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SavedChatsModal from '../src/renderer/src/components/ai/SavedChatsModal'
import type { SavedChats } from '../src/renderer/src/components/ai/useSavedChats'
import type { SavedChat } from '../src/renderer/src/components/ai/types'

afterEach(cleanup)

type Props = Parameters<typeof SavedChatsModal>[0]

const chat = (id: string, title: string, said = title): SavedChat => ({
  id, title, createdAt: 0, messages: [{ role: 'user', content: said }]
} as SavedChat)

const chats = [
  chat('c1', 'Onboarding epic'),
  chat('c2', 'Release checklist', 'What ships on Friday?'),
  chat('c3', 'Bug triage'),
  chat('c4', 'Standup notes')
]

const makeSpies = () => ({
  handleNewChat: vi.fn<Props['handleNewChat']>(),
  handleLoadChat: vi.fn<Props['handleLoadChat']>(),
  // the panel's handler stops the click, so delete never loads
  handleDeleteChat: vi.fn<Props['handleDeleteChat']>((...args) => args[1].stopPropagation()),
  handleSaveRename: vi.fn<SavedChats['handleSaveRename']>(),
  setShowSavedChatsModal: vi.fn<SavedChats['setShowSavedChatsModal']>()
})
type Spies = ReturnType<typeof makeSpies>

/** search and rename live in list state, the harness holds them */
function Drawer({ savedChats, spies }: { savedChats: SavedChat[]; spies: Spies }) {
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const list: Pick<SavedChats,
    | 'savedChats' | 'currentChatId' | 'chatSearchQuery' | 'setChatSearchQuery' | 'editingChatId'
    | 'setEditingChatId' | 'editingTitle' | 'setEditingTitle' | 'handleSaveRename' | 'setShowSavedChatsModal'> = {
    savedChats, currentChatId: '', chatSearchQuery, setChatSearchQuery, editingChatId, setEditingChatId,
    editingTitle, setEditingTitle, handleSaveRename: spies.handleSaveRename, setShowSavedChatsModal: spies.setShowSavedChatsModal
  }
  return (
    <SavedChatsModal
      chats={list as SavedChats}
      handleNewChat={spies.handleNewChat}
      handleLoadChat={spies.handleLoadChat}
      handleDeleteChat={spies.handleDeleteChat}
    />
  )
}

const renderDrawer = (savedChats: SavedChat[] = chats) => {
  const spies = makeSpies()
  render(<Drawer savedChats={savedChats} spies={spies} />)
  return spies
}

const search = () => screen.getByPlaceholderText('Search chats…')

describe('SavedChatsModal', () => {
  it('counts the chats against the limit, and says when there are none', () => {
    renderDrawer(chats.slice(0, 2))
    expect(screen.getByText('Saved Chats (2/50)')).toBeTruthy()
    cleanup()

    renderDrawer([])
    expect(screen.getByText('No saved conversations yet. Start chatting to auto-save!')).toBeTruthy()
  })

  it('offers search only once the list is long enough to need it', () => {
    renderDrawer(chats.slice(0, 3))
    expect(screen.queryByPlaceholderText('Search chats…')).toBeNull()
    cleanup()

    renderDrawer()
    expect(search()).toBeTruthy()
  })

  it('searches what was said as well as the titles, and says when nothing matches', () => {
    renderDrawer()

    fireEvent.change(search(), { target: { value: 'friday' } })
    expect(screen.getByText('Release checklist')).toBeTruthy()
    expect(screen.queryByText('Bug triage')).toBeNull()

    fireEvent.change(search(), { target: { value: '  zzz ' } })
    expect(screen.getByText('No chats match “zzz”.')).toBeTruthy()

    fireEvent.keyDown(search(), { key: 'Escape' })
    expect(screen.getByText('Bug triage')).toBeTruthy()
  })

  it('loads a chat from its row', () => {
    const { handleLoadChat } = renderDrawer()

    fireEvent.click(screen.getByText('Bug triage'))

    expect(handleLoadChat).toHaveBeenCalledWith(chats[2])
  })

  it('renames in place without loading the chat', () => {
    const { handleLoadChat, handleSaveRename } = renderDrawer()

    fireEvent.click(screen.getAllByTitle('Rename Chat')[0])
    const field = screen.getByDisplayValue('Onboarding epic')
    fireEvent.click(field)
    fireEvent.change(field, { target: { value: 'Epic planning' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(handleSaveRename).toHaveBeenCalledWith('c1')
    expect(handleLoadChat).not.toHaveBeenCalled()
  })

  it('gives up a rename on Escape', () => {
    renderDrawer()

    fireEvent.click(screen.getAllByTitle('Rename Chat')[0])
    fireEvent.keyDown(screen.getByDisplayValue('Onboarding epic'), { key: 'Escape' })

    expect(screen.queryByDisplayValue('Onboarding epic')).toBeNull()
    expect(screen.getByText('Onboarding epic')).toBeTruthy()
  })

  it('deletes a chat by its id', () => {
    const { handleDeleteChat } = renderDrawer()

    fireEvent.click(screen.getAllByTitle('Delete Chat')[1])

    expect(handleDeleteChat).toHaveBeenCalledTimes(1)
    expect(handleDeleteChat.mock.calls[0][0]).toBe('c2')
  })

  it('starts a new chat, and closes from the button beside it', () => {
    const { handleNewChat, setShowSavedChatsModal } = renderDrawer()
    const newButton = screen.getByText('New').closest('button')
    const close = newButton?.nextElementSibling
    if (!newButton || !(close instanceof HTMLButtonElement)) throw new Error('the header buttons moved')

    fireEvent.click(newButton)
    fireEvent.click(close)

    expect(handleNewChat).toHaveBeenCalledTimes(1)
    expect(setShowSavedChatsModal).toHaveBeenCalledWith(false)
  })
})
