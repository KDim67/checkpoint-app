/**
 * The saved conversations: the list kept in localStorage, which one is live,
 * and the drawer's search and rename state.
 *
 * Held by the panel rather than the drawer, which unmounts whenever it closes
 * while the list keeps syncing from the live conversation. Starting and loading
 * a chat stay in the panel, because they reset the stream as well.
 */

import { useEffect, useState } from 'react'
import type { Message, SavedChat } from './types'

const STORAGE_KEY_SAVED_CHATS = 'checkpoint_ai_saved_chats'

export function useSavedChats(messages: Message[]) {
  const [savedChats, setSavedChats] = useState<SavedChat[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SAVED_CHATS)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [currentChatId, setCurrentChatId] = useState<string>(() => `chat_${Date.now()}`)
  const [showSavedChatsModal, setShowSavedChatsModal] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  // Sync active messages into saved chats list (limit 50)
  useEffect(() => {
    if (messages.length === 0) return
    setSavedChats(prev => {
      const existingIdx = prev.findIndex(c => c.id === currentChatId)
      const firstUserMsg = messages.find(m => m.role === 'user')?.content || 'New Conversation'
      const defaultTitle = firstUserMsg.length > 28 ? firstUserMsg.slice(0, 28) + '...' : firstUserMsg

      let updated: SavedChat[]
      if (existingIdx >= 0) {
        updated = [...prev]
        updated[existingIdx] = {
          ...updated[existingIdx],
          messages,
          title: updated[existingIdx].title || defaultTitle
        }
      } else {
        const newChat: SavedChat = {
          id: currentChatId,
          title: defaultTitle,
          createdAt: Date.now(),
          messages
        }
        updated = [newChat, ...prev]
      }

      const capped = updated.slice(0, 50)
      try {
        localStorage.setItem(STORAGE_KEY_SAVED_CHATS, JSON.stringify(capped))
      } catch (e) {
        console.warn('Failed to persist saved chats:', e)
      }
      return capped
    })
  }, [messages, currentChatId])

  const removeChat = (id: string) => {
    const updated = savedChats.filter(c => c.id !== id)
    setSavedChats(updated)
    try {
      localStorage.setItem(STORAGE_KEY_SAVED_CHATS, JSON.stringify(updated))
    } catch {}
  }

  const handleSaveRename = (id: string) => {
    if (!editingTitle.trim()) {
      setEditingChatId(null)
      return
    }
    const updated = savedChats.map(c => c.id === id ? { ...c, title: editingTitle.trim() } : c)
    setSavedChats(updated)
    try {
      localStorage.setItem(STORAGE_KEY_SAVED_CHATS, JSON.stringify(updated))
    } catch {}
    setEditingChatId(null)
  }

  return {
    savedChats,
    currentChatId,
    setCurrentChatId,
    showSavedChatsModal,
    setShowSavedChatsModal,
    chatSearchQuery,
    setChatSearchQuery,
    editingChatId,
    setEditingChatId,
    editingTitle,
    setEditingTitle,
    removeChat,
    handleSaveRename
  }
}

export type SavedChats = ReturnType<typeof useSavedChats>
