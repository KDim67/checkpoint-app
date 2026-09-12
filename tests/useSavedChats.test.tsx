// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSavedChats } from '../src/renderer/src/components/ai/useSavedChats'
import type { Message } from '../src/renderer/src/components/ai/types'

const KEY = 'checkpoint_ai_saved_chats'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '[]')
const question: Message = { role: 'user', content: 'How should I split the onboarding epic into tickets?' }
const answer: Message = { role: 'assistant', content: 'Start with the account setup.' }

const renderChats = (messages: Message[] = []) =>
  renderHook(({ m }) => useSavedChats(m), { initialProps: { m: messages } })

describe('useSavedChats', () => {
  it('saves the live conversation under its first question, cut to fit', () => {
    const { result, rerender } = renderChats()
    expect(result.current.savedChats).toEqual([])

    rerender({ m: [question, answer] })

    expect(result.current.savedChats).toHaveLength(1)
    expect(result.current.savedChats[0].title).toBe('How should I split the onboa...')
    expect(stored()[0].messages).toHaveLength(2)
  })

  it('keeps updating the same entry as the conversation grows', () => {
    const { result, rerender } = renderChats()
    rerender({ m: [question] })
    rerender({ m: [question, answer, { role: 'user', content: 'And the billing part?' }] })

    expect(result.current.savedChats).toHaveLength(1)
    expect(result.current.savedChats[0].messages).toHaveLength(3)
  })

  it('renames with the title trimmed, and ignores a blank one', () => {
    const { result, rerender } = renderChats()
    rerender({ m: [question] })
    const id = result.current.savedChats[0].id

    act(() => { result.current.setEditingChatId(id); result.current.setEditingTitle('  Epic planning  ') })
    act(() => result.current.handleSaveRename(id))
    expect(result.current.savedChats[0].title).toBe('Epic planning')
    expect(stored()[0].title).toBe('Epic planning')
    expect(result.current.editingChatId).toBeNull()

    act(() => { result.current.setEditingChatId(id); result.current.setEditingTitle('   ') })
    act(() => result.current.handleSaveRename(id))
    expect(result.current.savedChats[0].title).toBe('Epic planning')
  })

  it('forgets a chat that is removed', () => {
    const { result, rerender } = renderChats()
    rerender({ m: [question] })

    act(() => result.current.removeChat(result.current.savedChats[0].id))

    expect(result.current.savedChats).toEqual([])
    expect(stored()).toEqual([])
  })

  it('brings back what an earlier session saved', () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'chat_1', title: 'Last week', createdAt: 1, messages: [] }]))

    const { result } = renderChats()

    expect(result.current.savedChats.map(c => c.title)).toEqual(['Last week'])
  })

  it('starts empty rather than failing when the stored list no longer parses', () => {
    localStorage.setItem(KEY, '{not json')

    const { result } = renderChats()

    expect(result.current.savedChats).toEqual([])
  })
})
