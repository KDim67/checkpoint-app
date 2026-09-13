/** state can't live in the modal, it unmounts while the stream writes; setters returned for consolidation */

import { useEffect, useState } from 'react'
import type { useToast } from '../ui/Toast'
import type { AiMemory, MemoryCategory } from '../../../../shared/types'
import * as memoryApi from '../../data/memory'

// re-exported so imports stay beside the vault
export type { MemoryCategory, AiMemory as MemoryRow } from '../../../../shared/types'

interface Options {
  activeWorkspace: string
  selectedModel: string
  /** typed off useToast so they can't drift */
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

  // reload on open and on workspace change so counts don't go stale
  useEffect(() => {
    if (!showMemoryPanel) return
    let cancelled = false
    setMemoryLoading(true)
    memoryApi.getMemories(activeWorkspace)
      .then(mems => { if (!cancelled) setMemories(mems || []) })
      .catch(e => { if (!cancelled) { console.warn('Failed to load memories:', e); setMemories([]) } })
      .finally(() => { if (!cancelled) setMemoryLoading(false) })
    return () => { cancelled = true }
  }, [showMemoryPanel, activeWorkspace])

  const handleAuditMemories = async () => {
    try {
      setMemoryLoading(true)
      const validContext = activeWorkspace || 'default'
      const audited = await memoryApi.auditMemories(validContext, selectedModel)
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
      await memoryApi.deleteMemory(id)
      setMemories(prev => prev.filter(m => m.id !== id))
    } catch (e) {
      console.warn('Failed to delete memory:', e)
    }
  }

  const handleTogglePinMemory = async (id: string) => {
    try {
      const newPinned = await memoryApi.togglePinMemory(id)
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
      await memoryApi.updateMemoryContent(id, editingMemoryContent)
      setMemories(prev => prev.map(m => m.id === id ? { ...m, content: editingMemoryContent, updated_at: Date.now() } : m))
      setEditingMemoryId(null)
    } catch (e) {
      console.warn('Failed to update memory:', e)
    }
  }

  const handleAddMemory = async () => {
    if (!newMemoryKey.trim() || !newMemoryContent.trim()) return
    try {
      const saved = await memoryApi.saveMemory({
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
