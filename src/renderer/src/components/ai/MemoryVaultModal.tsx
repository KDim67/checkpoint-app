/**
 * The memory vault modal. Lifted out of AiStreamPanel unchanged, down to the
 * JSX indentation, which is why it still opens with the same constant tables
 * rather than a tidier arrangement.
 *
 * State lives in useMemoryVault and arrives as one `vault` prop. It must not
 * move in here: this modal unmounts when closed, and the chat stream writes to
 * the vault while it is shut.
 */

import React from 'react'
import type { MemoryCategory } from '../../../../shared/memoryActions'
import { Brain, X, Plus, Search, Pin, Trash2, Edit2, RefreshCw } from 'lucide-react'
import type { MemoryVault } from './useMemoryVault'

interface Props {
  vault: MemoryVault
  /** Shown in the header, so the user knows whose memories these are. */
  activeWorkspace: string
}

export default function MemoryVaultModal({ vault, activeWorkspace }: Props) {
  const {
    setShowMemoryPanel,
    memories,
    memoryLoading,
    memorySearchQuery, setMemorySearchQuery,
    editingMemoryId, setEditingMemoryId,
    editingMemoryContent, setEditingMemoryContent,
    showAddMemoryForm, setShowAddMemoryForm,
    newMemoryKey, setNewMemoryKey,
    newMemoryContent, setNewMemoryContent,
    newMemoryCategory, setNewMemoryCategory,
    memoryConsolidating,
    handleAuditMemories,
    handleDeleteMemory,
    handleTogglePinMemory,
    handleStartEditMemory,
    handleSaveEditMemory,
    handleAddMemory
  } = vault

        const CATEGORY_COLORS: Record<string, string> = {
          semantic: '#3b82f6',
          episodic: '#f59e0b',
          working: '#6b7280'
        }
        const CATEGORY_LABELS: Record<string, string> = {
          semantic: 'FACT',
          episodic: 'EPISODE',
          working: 'WORKING'
        }
        const filteredMems = memorySearchQuery.trim()
          ? memories.filter(m =>
              m.memory_key.toLowerCase().includes(memorySearchQuery.toLowerCase()) ||
              m.content.toLowerCase().includes(memorySearchQuery.toLowerCase()) ||
              m.category.toLowerCase().includes(memorySearchQuery.toLowerCase())
            )
          : memories

        const pinnedMems = filteredMems.filter(m => m.is_pinned)
        const unpinnedMems = filteredMems.filter(m => !m.is_pinned)
        const orderedMems = [...pinnedMems, ...unpinnedMems]

        return (
          <div className="memory-vault-overlay" style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(10, 12, 18, 0.82)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px'
          }}>
            <style>{`
              .memory-vault-overlay {
                animation: memory-fade-in 150ms ease-out;
              }
              .memory-vault-card {
                animation: memory-scale-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
              }
            `}</style>
            <div className="memory-vault-card" style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)', width: '100%', maxHeight: '92%',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)', overflow: 'hidden'
            }}>
              {/* Header */}
              <div style={{
                padding: '12px 16px 10px',
                borderBottom: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-2)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                flexShrink: 0
              }}>
                {/* Row 1: Title and Close button */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Brain size={15} style={{ color: '#a855f7' }} />
                    <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--color-text-base)', letterSpacing: '0.01em' }}>
                      Memory Vault
                    </span>
                    {memoryConsolidating && (
                      <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <RefreshCw size={9} style={{ animation: 'spin 1s linear infinite' }} />
                        Consolidating…
                      </span>
                    )}
                  </div>
                  <button onClick={() => { setShowMemoryPanel(false); setShowAddMemoryForm(false); setEditingMemoryId(null); setMemorySearchQuery('') }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={15} />
                  </button>
                </div>

                {/* Row 2: Badges and Action buttons */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  {/* Badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', background: 'var(--color-surface-offset)', padding: '2px 8px', borderRadius: '10px', fontWeight: '500' }}>
                      Context: {activeWorkspace}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--color-accent-ai)', background: 'rgba(168,85,247,0.1)', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
                      {memories.length} memories
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      onClick={() => setShowAddMemoryForm(v => !v)}
                      style={{
                        background: showAddMemoryForm ? 'var(--color-secondary)' : 'rgba(168,85,247,0.12)',
                        border: '1px solid rgba(168,85,247,0.3)',
                        color: showAddMemoryForm ? '#fff' : '#a855f7',
                        borderRadius: 'var(--radius-sm)', padding: '4px 10px',
                        fontSize: '10px', fontWeight: 'bold', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        transition: 'all 150ms'
                      }}
                    >
                      <Plus size={10} /> Add Memory
                    </button>
                    <button
                      onClick={handleAuditMemories}
                      disabled={memoryLoading || memories.length === 0}
                      style={{
                        background: 'rgba(168,85,247,0.12)',
                        border: '1px solid rgba(168,85,247,0.3)',
                        color: '#a855f7',
                        borderRadius: 'var(--radius-sm)', padding: '4px 10px',
                        fontSize: '10px', fontWeight: 'bold', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        transition: 'all 150ms'
                      }}
                    >
                      <RefreshCw size={10} style={{ animation: memoryLoading ? 'spin 1s linear infinite' : 'none' }} />
                      Audit &amp; Prune
                    </button>
                  </div>
                </div>
              </div>

              {/* Search Bar */}
              <div style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-1)',
                flexShrink: 0,
                position: 'relative',
                display: 'flex',
                alignItems: 'center'
              }}>
                <Search
                  size={12}
                  style={{
                    position: 'absolute',
                    left: '26px',
                    color: 'var(--color-text-faint)',
                    pointerEvents: 'none'
                  }}
                />
                <input
                  type="text"
                  placeholder="Search memories by keyword, fact, or type…"
                  value={memorySearchQuery}
                  onChange={e => setMemorySearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text-base)',
                    fontSize: '11px',
                    padding: '8px 12px 8px 30px',
                    outline: 'none',
                    transition: 'border-color 150ms ease, box-shadow 150ms ease'
                  }}
                />
                {memorySearchQuery && (
                  <button
                    onClick={() => setMemorySearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '26px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '2px'
                    }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              {/* Add Memory Form */}
              {showAddMemoryForm && (
                <div style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-surface-offset)',
                  background: 'rgba(168,85,247,0.04)',
                  border: '1px dashed rgba(168,85,247,0.2)',
                  borderRadius: 'var(--radius-md)',
                  margin: '8px 16px 0 16px',
                  display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0
                }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      placeholder="Memory key (e.g. player_movement_system)"
                      value={newMemoryKey}
                      onChange={e => setNewMemoryKey(e.target.value)}
                      style={{
                        flex: 1, background: 'var(--color-surface-2)',
                        border: '1px solid rgba(168,85,247,0.3)',
                        borderRadius: 'var(--radius-sm)', color: 'var(--color-text-base)',
                        fontSize: '11px', padding: '5px 8px', outline: 'none'
                      }}
                    />
                    <select
                      value={newMemoryCategory}
                      onChange={e => setNewMemoryCategory(e.target.value as MemoryCategory)}
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid rgba(168,85,247,0.3)',
                        borderRadius: 'var(--radius-sm)', color: 'var(--color-text-base)',
                        fontSize: '11px', padding: '5px 6px', outline: 'none'
                      }}
                    >
                      <option value="semantic">Semantic (Fact)</option>
                      <option value="episodic">Episodic (Event)</option>
                      <option value="working">Working (Temp)</option>
                    </select>
                  </div>
                  <textarea
                    placeholder="What should the AI remember?"
                    value={newMemoryContent}
                    onChange={e => setNewMemoryContent(e.target.value)}
                    rows={2}
                    style={{
                      width: '100%', boxSizing: 'border-box', resize: 'none',
                      background: 'var(--color-surface-2)',
                      border: '1px solid rgba(168,85,247,0.3)',
                      borderRadius: 'var(--radius-sm)', color: 'var(--color-text-base)',
                      fontSize: '11px', padding: '5px 8px', outline: 'none',
                      fontFamily: 'inherit'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                    <button
                      onClick={() => { setShowAddMemoryForm(false); setNewMemoryKey(''); setNewMemoryContent('') }}
                      style={{ background: 'transparent', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-sm)', padding: '3px 10px', fontSize: '10px', cursor: 'pointer' }}
                    >Cancel</button>
                    <button
                      onClick={handleAddMemory}
                      disabled={!newMemoryKey.trim() || !newMemoryContent.trim()}
                      style={{
                        background: newMemoryKey.trim() && newMemoryContent.trim() ? 'var(--color-accent-ai)' : 'var(--color-surface-offset)',
                        border: 'none',
                        // Disabled, the fill is a plain surface rather than the
                        // purple, and white on it did not survive light mode.
                        color: newMemoryKey.trim() && newMemoryContent.trim() ? 'var(--color-on-accent)' : 'var(--color-text-faint)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '3px 10px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer'
                      }}
                    >Save Memory</button>
                  </div>
                </div>
              )}

              {/* Memory List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {memoryLoading ? (
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', textAlign: 'center', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    Loading memories…
                  </div>
                ) : orderedMems.length === 0 ? (
                  <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center', padding: '24px', fontStyle: 'italic', lineHeight: 1.6 }}>
                    {memorySearchQuery ? `No memories match "${memorySearchQuery}"` : (
                      <>No memories stored for this workspace yet.<br />The AI will automatically extract important facts as you chat.</>
                    )}
                  </div>
                ) : (
                  orderedMems.map(mem => (
                    <div key={mem.id} style={{
                      padding: '14px 16px',
                      background: mem.is_pinned
                        ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(59, 130, 246, 0.03) 100%)'
                        : 'var(--color-surface-2)90',
                      border: mem.is_pinned ? '1px solid rgba(168, 85, 247, 0.35)' : '1px solid var(--color-surface-offset)',
                      borderLeft: mem.is_pinned ? '4px solid #a855f7' : '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      transition: 'all 200ms ease',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)'
                    }}>
                      {/* Memory Header Row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden', minWidth: 0 }}>
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 'var(--weight-bold)',
                            flexShrink: 0,
                            letterSpacing: '0.04em',
                            color: mem.category === 'semantic' ? 'var(--color-primary-soft)' : mem.category === 'episodic' ? '#fbbf24' : '#9ca3af',
                            background: mem.category === 'semantic' ? 'rgba(59, 130, 246, 0.1)' : mem.category === 'episodic' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                            border: `1px solid ${mem.category === 'semantic' ? 'rgba(59, 130, 246, 0.2)' : mem.category === 'episodic' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(107, 114, 128, 0.2)'}`,
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}>
                            {CATEGORY_LABELS[mem.category] || mem.category.toUpperCase()}
                          </span>
                          <span style={{
                            fontSize: '12px',
                            fontWeight: 'var(--weight-semibold)',
                            color: mem.is_pinned ? 'var(--color-accent-ai-soft)' : 'var(--color-text-base)',
                            fontFamily: 'var(--font-mono)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {mem.memory_key}
                          </span>
                        </div>
                        {/* Action Buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <button
                            onClick={() => handleTogglePinMemory(mem.id)}
                            title={mem.is_pinned ? 'Unpin memory' : 'Pin memory (always recalled first)'}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: mem.is_pinned ? '#a855f7' : 'var(--color-text-faint)',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'color 150ms, background-color 150ms'
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.15)'
                              e.currentTarget.style.color = '#a855f7'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                              if (!mem.is_pinned) e.currentTarget.style.color = 'var(--color-text-faint)'
                            }}
                          >
                            <Pin size={11} fill={mem.is_pinned ? 'currentColor' : 'none'} style={{ transform: mem.is_pinned ? 'none' : 'rotate(45deg)' }} />
                          </button>
                          <button
                            onClick={() => editingMemoryId === mem.id ? setEditingMemoryId(null) : handleStartEditMemory(mem)}
                            title="Edit memory content"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--color-text-faint)',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'color 150ms, background-color 150ms'
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.15)'
                              e.currentTarget.style.color = '#3b82f6'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                              e.currentTarget.style.color = 'var(--color-text-faint)'
                            }}
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            onClick={() => handleDeleteMemory(mem.id)}
                            title="Delete memory"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--color-text-faint)',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'color 150ms, background-color 150ms'
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'
                              e.currentTarget.style.color = '#ef4444'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                              e.currentTarget.style.color = 'var(--color-text-faint)'
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>

                      {/* Content. Editable or read-only */}
                      {editingMemoryId === mem.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <textarea
                            value={editingMemoryContent}
                            onChange={e => setEditingMemoryContent(e.target.value)}
                            rows={3}
                            autoFocus
                            style={{
                              width: '100%', boxSizing: 'border-box', resize: 'vertical',
                              background: 'var(--color-surface-1)',
                              border: '1px solid rgba(59,130,246,0.4)',
                              borderRadius: '3px', color: 'var(--color-text-base)',
                              fontSize: '11px', padding: '4px 6px', outline: 'none',
                              fontFamily: 'inherit', lineHeight: 1.4
                            }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                            <button
                              onClick={() => setEditingMemoryId(null)}
                              style={{ background: 'transparent', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)', borderRadius: '3px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}
                            >Cancel</button>
                            <button
                              onClick={() => handleSaveEditMemory(mem.id)}
                              style={{ background: 'var(--color-primary)', border: 'none', color: 'var(--color-on-accent)', borderRadius: '3px', padding: '2px 8px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                            >Save</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.5, paddingLeft: '2px' }}>
                          {mem.content}
                        </div>
                      )}

                      {/* Footer meta */}
                      <div style={{ fontSize: '9px', color: 'var(--color-text-faint)', display: 'flex', gap: '8px', paddingLeft: '2px' }}>
                        <span>Recalled {mem.access_count}×</span>
                        <span>·</span>
                        <span>Updated {new Date(mem.updated_at).toLocaleDateString()}</span>
                        {mem.is_pinned && <span style={{ color: '#a855f7' }}>· Always recalled</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer legend */}
              <div style={{
                padding: '6px 14px',
                borderTop: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-2)',
                display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0
              }}>
                {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: CATEGORY_COLORS[cat], display: 'inline-block', flexShrink: 0
                    }} />
                    <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>{label}</span>
                  </div>
                ))}
                <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', marginLeft: 'auto' }}>
                  Auto-extracted after each AI response
                </span>
              </div>
            </div>
          </div>
        )
}
