import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '../ui/Toast'
import { normalizeDialogueNodes, type DialogueNode } from './types'
import { themeTokenHex, useThemeVersion } from '../../lib/themeTokens'

/** raised by the AI panel to hand over a tree */
export const AI_DIALOGUE_EVENT = 'ai-load-dialogue-tree'

/** a hook so the AI hand-off listener stays live while another tool is open */
export function useDialogueTool(onActivate: () => void) {
  const { toast } = useToast()
  // re-render on theme change so colours are re-read
  useThemeVersion()

  /** outside the memo so it's a real dependency; a bare version counter looks like a no-op dep */
  // hex, mermaid can't parse the rgba the token resolves to (see themeTokenHex)
  const rootClassDef =
    `  classDef root fill:${themeTokenHex('--color-secondary-muted', '#202510', '--color-surface-2')}` +
    `,stroke:${themeTokenHex('--color-secondary', '#cdf12b', '--color-surface-2')}` +
    `,color:${themeTokenHex('--color-secondary', '#cdf12b', '--color-surface-2')};\n\n`

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

    // custom events aren't in WindowEventMap, narrow the plain Event
    window.addEventListener(AI_DIALOGUE_EVENT, handleAiDialogueLoad)
    return () => window.removeEventListener(AI_DIALOGUE_EVENT, handleAiDialogueLoad)
  }, [toast, onActivate])

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
    // no classDef for normal nodes, it forced dark-theme colours; MermaidChart passes the live theme
    code += rootClassDef

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
  }, [dialogueNodes, rootClassDef])

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
