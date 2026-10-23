import { useState, useEffect, useCallback } from 'react'
import type { AiMemory } from '../../../../shared/types'
import { Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import * as memoryApi from '../../data/memory'
import { useFailureReport } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'

export default function MemoryVaultManager() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const report = useFailureReport()
  const confirm = useConfirm()
  const [memories, setMemories] = useState<AiMemory[]>([])
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [loading, setLoading] = useState(true)

  const loadMemories = useCallback(async () => {
    try {
      const list = await memoryApi.getMemories(activeWorkspace)
      setMemories(list || [])
    } catch (e) { report('load the memories', e) }
    finally { setLoading(false) }
  }, [activeWorkspace, report])

  useEffect(() => { loadMemories() }, [loadMemories])

  const complete = newKey.trim() !== '' && newContent.trim() !== ''

  const handleAddMemory = async () => {
    if (!complete) return
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
    } catch (e) { report('save the memory', e) }
  }

  // a memory can't be brought back, so it's asked about first
  const handleDeleteMemory = async (memory: AiMemory) => {
    const ok = await confirm({
      title: 'Forget this?',
      message: `The assistant stops knowing "${memory.memory_key}".`,
      confirmText: 'Forget',
      isDestructive: true
    })
    if (!ok) return
    try {
      await memoryApi.deleteMemory(memory.id)
      loadMemories()
    } catch (e) { report('delete the memory', e) }
  }

  return (
    <div className="col-md">
      <p className="text-sub" style={{ margin: 0 }}>
        Rules, preferences and names it should always know. It can also save some itself while you chat.
      </p>

      <form
        className="settings-list"
        onSubmit={e => { e.preventDefault(); void handleAddMemory() }}
        style={{ padding: 'var(--space-3)', flexDirection: 'row', flexWrap: 'wrap', gap: 'var(--space-2)', background: 'var(--color-surface-2)' }}
      >
        <input
          type="text"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="Name, e.g. antagonist_name"
          aria-label="What it's about"
          className="input-md"
          style={{ flex: '1 1 11rem', minWidth: 0 }}
        />
        <input
          type="text"
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
          placeholder="What to remember, e.g. Chronos, master of time loops"
          aria-label="What to remember"
          className="input-md"
          style={{ flex: '2 1 15rem', minWidth: 0 }}
        />
        <button type="submit" className="btn-primary btn-small" disabled={!complete}>
          <Plus size={12} aria-hidden="true" />
          Remember
        </button>
      </form>

      {memories.length > 0 && (
        <ul className="settings-list" aria-label="Memories" style={{ maxHeight: '15rem', overflowY: 'auto' }}>
          {memories.map(mem => (
            <li key={mem.id} className="settings-list-row" style={{ flexWrap: 'nowrap' }}>
              <div className="settings-row-text">
                <div className="text-item" style={{ color: 'var(--color-secondary)' }}>{mem.memory_key}</div>
                <div className="text-hint">{mem.content}</div>
              </div>
              <button
                type="button"
                onClick={() => handleDeleteMemory(mem)}
                className="btn-icon hover-text-error"
                aria-label={`Forget ${mem.memory_key}`}
                title="Forget this"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {memories.length === 0 && !loading && (
        <p className="text-sub" style={{ margin: 0, textAlign: 'center', padding: 'var(--space-3)' }}>
          Nothing remembered for this workspace yet.
        </p>
      )}
    </div>
  )
}
