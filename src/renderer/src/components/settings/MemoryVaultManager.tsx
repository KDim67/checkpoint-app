import { useState, useEffect, useCallback } from 'react'
import type { AiMemory } from '../../../../shared/types'
import { Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import * as memoryApi from '../../data/memory'

export default function MemoryVaultManager() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const [memories, setMemories] = useState<AiMemory[]>([])
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [loading, setLoading] = useState(true)

  const loadMemories = useCallback(async () => {
    try {
      const list = await memoryApi.getMemories(activeWorkspace)
      setMemories(list || [])
    } catch (e) { console.warn('Failed to load memories:', e) }
    finally { setLoading(false) }
  }, [activeWorkspace])

  useEffect(() => { loadMemories() }, [loadMemories])

  const handleAddMemory = async () => {
    if (!newKey.trim() || !newContent.trim()) return
    try {
      await memoryApi.saveMemory({
        context: activeWorkspace || 'default',
        category: 'semantic',
        memory_key: newKey.trim(),
        content: newContent.trim()
      })
      setNewKey('')
      setNewContent('')
      loadMemories()
    } catch (e) { console.warn('Failed to save memory:', e) }
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      await memoryApi.deleteMemory(id)
      loadMemories()
    } catch (e) { console.warn('Failed to delete memory:', e) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="row-between">
        <div className="text-label-xs-semibold">
          AI Persistent Memory Vault ({memories.length})
        </div>
        <span className="text-micro-faint">Active workspace: {activeWorkspace || 'default'}</span>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', lineHeight: 1.4 }}>
        Manage stored project rules, preferences, and game lore recalled automatically during AI chat sessions.
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', background: 'var(--color-surface-2)', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-surface-offset)' }}>
        <input
          type="text"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="Memory Key (e.g. antagonist_name)"
          style={{ flex: '1 1 180px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', color: 'var(--color-text-base)', fontSize: '11px', outline: 'none' }}
        />
        <input
          type="text"
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
          placeholder="Memory Content (e.g. Chronos, master of time loops)"
          style={{ flex: '2 1 240px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', color: 'var(--color-text-base)', fontSize: '11px', outline: 'none' }}
        />
        <button
          onClick={handleAddMemory}
          style={{ background: 'var(--color-secondary)', border: 'none', color: 'var(--color-text-inverted)', borderRadius: 'var(--radius-sm)', padding: '6px 12px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <Plus size={12} />
          <span>Save Memory</span>
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
        {memories.map(mem => (
          <div key={mem.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', fontSize: '11px' }}>
            <div className="col-2px">
              <div style={{ fontWeight: 'bold', color: 'var(--color-secondary)' }}>{mem.memory_key} <span style={{ fontSize: '9px', opacity: 0.6, color: 'var(--color-text-muted)' }}>({mem.category})</span></div>
              <div className="text-base">{mem.content}</div>
            </div>
            <button onClick={() => handleDeleteMemory(mem.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {memories.length === 0 && !loading && (
          <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontStyle: 'italic', textAlign: 'center', padding: '12px' }}>
            No memories stored for this context yet. Add facts above or let the AI auto-save rules during chat.
          </div>
        )}
      </div>
    </div>
  )
}
