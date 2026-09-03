/**
 * The saved-conversation drawer: search, rename, load and delete.
 *
 * `currentChatId` is what marks the live conversation in the list; the drawer
 * never reads the messages themselves.
 *
 * Lifted out of AiStreamPanel with its JSX unchanged. State stays in the panel
 * and arrives as props: this unmounts every time it closes, so it must not own
 * anything worth keeping.
 */

import React from 'react'
import { Edit2, MessageSquare, Plus, Search, Trash2, X } from 'lucide-react'
import type { SavedChat } from './types'

interface Props {
  savedChats: SavedChat[]
  currentChatId: string
  chatSearchQuery: string
  setChatSearchQuery: React.Dispatch<React.SetStateAction<string>>
  editingChatId: string | null
  setEditingChatId: React.Dispatch<React.SetStateAction<string | null>>
  editingTitle: string
  setEditingTitle: React.Dispatch<React.SetStateAction<string>>
  handleNewChat: () => void
  handleLoadChat: (chat: SavedChat) => void
  handleDeleteChat: (id: string, e: React.MouseEvent) => void
  handleSaveRename: (id: string) => void
  setShowSavedChatsModal: React.Dispatch<React.SetStateAction<boolean>>
}

export default function SavedChatsModal({
  savedChats,
  currentChatId,
  chatSearchQuery,
  setChatSearchQuery,
  editingChatId,
  setEditingChatId,
  editingTitle,
  setEditingTitle,
  handleNewChat,
  handleLoadChat,
  handleDeleteChat,
  handleSaveRename,
  setShowSavedChatsModal
}: Props) {
  return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)'
          }}
        >
          <div
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              width: '100%',
              maxHeight: '90%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
              }}
            >
              <div className="row">
                <MessageSquare size={14} style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                  Saved Chats ({savedChats.length}/50)
                </span>
              </div>
              <div className="row">
                <button
                  onClick={handleNewChat}
                  style={{
                    background: 'var(--color-secondary)',
                    color: '#000',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    padding: '2px 8px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px'
                  }}
                >
                  <Plus size={10} />
                  <span>New</span>
                </button>
                <button
                  onClick={() => setShowSavedChatsModal(false)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Search */}
            {savedChats.length > 3 && (
              <div style={{ padding: 'var(--space-2) var(--space-3) 0', position: 'relative', flexShrink: 0 }}>
                <Search size={12} style={{ position: 'absolute', left: 'calc(var(--space-3) + 8px)', top: 'calc(50% + 4px)', transform: 'translateY(-50%)', color: 'var(--color-text-faint)', pointerEvents: 'none' }} />
                <input
                  type="text"
                  placeholder="Search chats…"
                  value={chatSearchQuery}
                  onChange={e => setChatSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setChatSearchQuery('') }}
                  style={{
                    width: '100%',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '5px 8px 5px 26px',
                    fontSize: '11px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            )}

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(() => {
                const q = chatSearchQuery.trim().toLowerCase()
                const visibleChats = q
                  ? savedChats.filter(c =>
                      c.title.toLowerCase().includes(q) ||
                      c.messages.some(m => m.content.toLowerCase().includes(q)))
                  : savedChats
                if (savedChats.length === 0) {
                  return (
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center', padding: 'var(--space-4)' }}>
                      No saved conversations yet. Start chatting to auto-save!
                    </div>
                  )
                }
                if (visibleChats.length === 0) {
                  return (
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center', padding: 'var(--space-4)' }}>
                      No chats match “{chatSearchQuery.trim()}”.
                    </div>
                  )
                }
                return visibleChats.map(chat => {
                  const isActive = chat.id === currentChatId
                  const isEditing = editingChatId === chat.id
                  return (
                    <div
                      key={chat.id}
                      onClick={() => handleLoadChat(chat)}
                      style={{
                        padding: '8px 10px',
                        background: isActive ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                        border: isActive ? '1px solid var(--color-secondary)' : '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'background 150ms ease'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden', flex: 1, marginRight: '8px' }}>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingTitle}
                            autoFocus
                            onClick={e => e.stopPropagation()}
                            onChange={e => setEditingTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveRename(chat.id)
                              if (e.key === 'Escape') setEditingChatId(null)
                            }}
                            onBlur={() => handleSaveRename(chat.id)}
                            style={{
                              background: 'var(--color-surface-1)',
                              border: '1px solid var(--color-secondary)',
                              color: 'var(--color-text-base)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '1px 4px',
                              fontSize: '11px',
                              outline: 'none'
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: '11px', fontWeight: isActive ? 'bold' : 'normal', color: isActive ? 'var(--color-secondary)' : 'var(--color-text-base)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {chat.title}
                          </span>
                        )}
                        <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>
                          {chat.messages.length} messages • {new Date(chat.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setEditingChatId(chat.id)
                            setEditingTitle(chat.title)
                          }}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
                          title="Rename Chat"
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          onClick={e => handleDeleteChat(chat.id, e)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
                          title="Delete Chat"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </div>
  )
}
