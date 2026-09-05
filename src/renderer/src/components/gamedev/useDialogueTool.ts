import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '../ui/Toast'
import { normalizeDialogueNodes, type DialogueNode } from './types'

/** Raised by the AI panel when it has a dialogue tree to hand over. */
const AI_DIALOGUE_EVENT = 'ai-load-dialogue-tree'

/**
 * Dialogue Quest Flow state, editing operations, and the Mermaid compilation.
 *
 * A hook rather than state inside DialoguePanel: the panel unmounts on tab
 * switch, and the ai-load-dialogue-tree listener has to stay live while the
 * user is on another tool for the AI hand-off to land at all.
 */
export function useDialogueTool(onActivate: () => void) {
  const { toast } = useToast()

  // Tab 3: Dialogue Quest Flow State
  const [dialogueNodes, setDialogueNodes] = useState<DialogueNode[]>([
    { id: 'start', speaker: 'Hero', text: 'Hello traveler, do you have any quests?', choices: [{ text: 'Yes, help me!', nextId: 'quest_accept' }, { text: 'No, begone.', nextId: 'quit' }] },
    { id: 'quest_accept', speaker: 'Elder', text: 'Slay 5 wolves in the valley.', choices: [{ text: 'I will do it.', nextId: 'quest_active' }] },
    { id: 'quest_active', speaker: 'Narrator', text: 'Quest added: Wolf Hunter.', choices: [] },
    { id: 'quit', speaker: 'Elder', text: 'Hmph. Safe travels.', choices: [] }
  ])
  const [nodeSpeaker, setNodeSpeaker] = useState('')
  const [nodeText, setNodeText] = useState('')
  const [nodeId, setNodeId] = useState('')
  const [dialogueViewMode, setDialogueViewMode] = useState<'code' | 'visual'>('visual')
  const [dialogueChoiceInputs, setDialogueChoiceInputs] = useState<Record<string, { text: string; nextId: string }>>({})

  useEffect(() => {
    const handleAiDialogueLoad = (evt: Event): void => {
      const detail = (evt as CustomEvent<{ nodes?: unknown }>).detail
      const nodes = normalizeDialogueNodes(
        detail?.nodes,
        () => `node_${Math.random().toString(36).slice(2, 7)}`
      )
      if (nodes.length === 0) return

      setDialogueNodes(nodes)
      onActivate()
      toast('Loaded AI Dialogue Quest Tree into Workspace!', { type: 'success' })
    }

    // A custom event name is not in WindowEventMap, so the listener is typed
    // as the plain Event it really receives and narrowed inside.
    window.addEventListener(AI_DIALOGUE_EVENT, handleAiDialogueLoad)
    return () => window.removeEventListener(AI_DIALOGUE_EVENT, handleAiDialogueLoad)
  }, [toast, onActivate])

  // Tab 3: Dialogue Editor Logic
  const addDialogueNode = useCallback(() => {
    if (!nodeId) {
      toast('Node ID is required', { type: 'info' })
      return
    }
    if (dialogueNodes.some(n => n.id === nodeId)) {
      toast('Node ID must be unique', { type: 'info' })
      return
    }
    setDialogueNodes(prev => [...prev, {
      id: nodeId,
      speaker: nodeSpeaker || 'Narrator',
      text: nodeText || '',
      choices: []
    }])
    setNodeId('')
    setNodeSpeaker('')
    setNodeText('')
    toast('Dialogue node created!', { type: 'success' })
  }, [nodeId, dialogueNodes, nodeSpeaker, nodeText, toast])

  const removeDialogueNode = useCallback((id: string) => {
    setDialogueNodes(prev => prev.filter(n => n.id !== id))
  }, [])

  const addChoiceToNode = useCallback((nodeIndex: number, text: string, nextId: string) => {
    if (!text || !nextId) return
    setDialogueNodes(prev => {
      const copy = [...prev]
      copy[nodeIndex] = {
        ...copy[nodeIndex],
        choices: [...copy[nodeIndex].choices, { text, nextId }]
      }
      return copy
    })
  }, [])

  const removeChoiceFromNode = useCallback((nodeIndex: number, choiceIndex: number) => {
    setDialogueNodes(prev => {
      const copy = [...prev]
      const updatedChoices = [...copy[nodeIndex].choices]
      updatedChoices.splice(choiceIndex, 1)
      copy[nodeIndex] = {
        ...copy[nodeIndex],
        choices: updatedChoices
      }
      return copy
    })
  }, [])

  const compiledMermaid = useMemo(() => {
    let code = 'graph TD\n'
    code += '  %% Theme configurations\n'
    code += '  classDef default fill:#1b1f30,stroke:#24293f,color:#f1f5f9;\n'
    code += '  classDef root fill:#202510,stroke:#cdf12b,color:#cdf12b;\n\n'

    dialogueNodes.forEach(node => {
      const label = `"${node.speaker || 'Narrator'}:\\n${(node.text || '').replace(/"/g, "'")}"`
      code += `  ${node.id}[${label}]\n`
      if (node.id === 'start') {
        code += `  class ${node.id} root;\n`
      }
      node.choices.forEach(c => {
        const choiceText = c.text ? `|"${c.text.replace(/"/g, "'")}"|` : ''
        code += `  ${node.id} -->${choiceText} ${c.nextId}\n`
      })
    })
    return code
  }, [dialogueNodes])

  return {
    dialogueNodes,
    nodeSpeaker,
    setNodeSpeaker,
    nodeText,
    setNodeText,
    nodeId,
    setNodeId,
    dialogueViewMode,
    setDialogueViewMode,
    dialogueChoiceInputs,
    setDialogueChoiceInputs,
    addDialogueNode,
    removeDialogueNode,
    addChoiceToNode,
    removeChoiceFromNode,
    compiledMermaid
  }
}

export type DialogueTool = ReturnType<typeof useDialogueTool>
