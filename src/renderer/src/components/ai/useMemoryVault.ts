/**
 * The memory vault's state, loader and CRUD. Same pattern as GameDevView: a
 * hook called unconditionally, paired with a panel taking its return as a prop.
 *
 * The state cannot live in the modal, which unmounts whenever it is closed
 * while the chat stream keeps writing to it. That is also why the setters are
 * returned: consolidation runs after each AI turn and reaches back in here.
 *
 * Names are unchanged from when this was inline, so the move is verifiable.
 */

import { useEffect, useState } from 'react'
import type { useToast } from '../ui/Toast'
import type { AiMemory, MemoryCategory } from '../../../../shared/types'

// Re-exported so the modal and the panel can keep importing them from here,
// where the vault they belong to lives.
export type { MemoryCategory, AiMemory as MemoryRow } from '../../../../shared/types'

interface Options {
  activeWorkspace: string
  selectedModel: string
  /** Typed off useToast so the two cannot drift apart. */
  toast: ReturnType<typeof useToast>['toast']
}

export function useMemoryVault({ activeWorkspace, selectedModel, toast }: Options) {
  const [showMemoryPanel, setShowMemoryPanel] = useState(false)
  const [memories, setMemories] = useState<AiMemory[]>([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memorySearchQuery, setMemorySearchQuery] = useState('')
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [editingMemoryContent, setEditingMemoryContent] = useState('')
  const [showAddMemoryForm, setShowAddMemoryForm] = useState(false)
  const [newMemoryKey, setNewMemoryKey] = useState('')
  const [newMemoryContent, setNewMemoryContent] = useState('')
  const [newMemoryCategory, setNewMemoryCategory] = useState<MemoryCategory>('semantic')
  const [memoryConsolidating, setMemoryConsolidating] = useState(false)

  // Reloaded whenever the vault opens (from the header chip, /mem, or the "N
  // recalled" pill) and whenever the workspace changes while it is open. This is
  // what keeps it in sync with the Settings memory vault rather than showing a
  // stale or empty count.
  useEffect(() => {
    if (!showMemoryPanel) return
    let cancelled = false
    setMemoryLoading(true)
    window.electronAPI.memory.getMemories(activeWorkspace)
      .then(mems => { if (!cancelled) setMemories(mems || []) })
      .catch(e => { if (!cancelled) { console.warn('Failed to load memories:', e); setMemories([]) } })
      .finally(() => { if (!cancelled) setMemoryLoading(false) })
    return () => { cancelled = true }
  }, [showMemoryPanel, activeWorkspace])

  const handleAuditMemories = async () => {
    try {
      setMemoryLoading(true)
      const validContext = activeWorkspace || 'default'
      const audited = await window.electronAPI.memory.auditMemories(validContext, selectedModel)
      setMemories(audited)
      toast('Memory vault audited and optimized!', { type: 'success' })
    } catch (e) {
      console.warn('Memory audit failed:', e)
    } finally {
      setMemoryLoading(false)
    }
  }

  const handleOpenMemoryPanel = (): void => {
    setShowMemoryPanel(true)
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      await window.electronAPI.memory.deleteMemory(id)
      setMemories(prev => prev.filter(m => m.id !== id))
    } catch (e) {
      console.warn('Failed to delete memory:', e)
    }
  }

  const handleTogglePinMemory = async (id: string) => {
    try {
      const newPinned = await window.electronAPI.memory.togglePinMemory(id)
      setMemories(prev => prev.map(m => m.id === id ? { ...m, is_pinned: newPinned } : m))
    } catch (e) {
      console.warn('Failed to toggle pin memory:', e)
    }
  }

  const handleStartEditMemory = (mem: AiMemory) => {
    setEditingMemoryId(mem.id)
    setEditingMemoryContent(mem.content)
  }

  const handleSaveEditMemory = async (id: string) => {
    try {
      await window.electronAPI.memory.updateMemoryContent(id, editingMemoryContent)
      setMemories(prev => prev.map(m => m.id === id ? { ...m, content: editingMemoryContent, updated_at: Date.now() } : m))
      setEditingMemoryId(null)
    } catch (e) {
      console.warn('Failed to update memory:', e)
    }
  }

  const handleAddMemory = async () => {
    if (!newMemoryKey.trim() || !newMemoryContent.trim()) return
    try {
      const saved = await window.electronAPI.memory.saveMemory({
        context: activeWorkspace || 'default',
        category: newMemoryCategory,
        memory_key: newMemoryKey.trim(),
        content: newMemoryContent.trim()
      })
      setMemories(prev => [saved, ...prev])
      setNewMemoryKey('')
      setNewMemoryContent('')
      setNewMemoryCategory('semantic')
      setShowAddMemoryForm(false)
    } catch (e) {
      console.warn('Failed to add memory:', e)
    }
  }

  return {
    showMemoryPanel, setShowMemoryPanel,
    memories, setMemories,
    memoryLoading,
    memorySearchQuery, setMemorySearchQuery,
    editingMemoryId, setEditingMemoryId,
    editingMemoryContent, setEditingMemoryContent,
    showAddMemoryForm, setShowAddMemoryForm,
    newMemoryKey, setNewMemoryKey,
    newMemoryContent, setNewMemoryContent,
    newMemoryCategory, setNewMemoryCategory,
    memoryConsolidating, setMemoryConsolidating,
    handleAuditMemories,
    handleOpenMemoryPanel,
    handleDeleteMemory,
    handleTogglePinMemory,
    handleStartEditMemory,
    handleSaveEditMemory,
    handleAddMemory
  }
}

export type MemoryVault = ReturnType<typeof useMemoryVault>
