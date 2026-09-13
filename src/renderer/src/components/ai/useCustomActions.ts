/** held by the panel, not the modal: the modal unmounts, the input always lists actions */

import { useEffect, useState } from 'react'
import { getJsonSetting, setJsonSetting } from '../../lib/settings'
import type { CustomAction } from './types'

export function useCustomActions() {
  const [customActions, setCustomActions] = useState<CustomAction[]>([])
  const [showCustomActionsModal, setShowCustomActionsModal] = useState(false)
  const [caLabel, setCaLabel] = useState('')
  const [caPrompt, setCaPrompt] = useState('')
  const [caIntent, setCaIntent] = useState<'create' | 'analyze'>('analyze')

  useEffect(() => {
    getJsonSetting<CustomAction[]>('ai_custom_actions', []).then(list => {
      if (Array.isArray(list)) setCustomActions(list.filter(a => a && a.id && a.label && a.prompt))
    }).catch(() => {})
  }, [])

  const persistCustomActions = (list: CustomAction[]): void => {
    setCustomActions(list)
    setJsonSetting('ai_custom_actions', list).catch(() => {})
  }

  const handleAddCustomAction = (): void => {
    if (!caLabel.trim() || !caPrompt.trim()) return
    persistCustomActions([
      ...customActions,
      { id: `ca_${Date.now()}`, label: caLabel.trim().slice(0, 40), prompt: caPrompt.trim(), intent: caIntent }
    ])
    setCaLabel('')
    setCaPrompt('')
    setCaIntent('analyze')
  }

  return {
    customActions,
    showCustomActionsModal,
    setShowCustomActionsModal,
    caLabel,
    setCaLabel,
    caPrompt,
    setCaPrompt,
    caIntent,
    setCaIntent,
    persistCustomActions,
    handleAddCustomAction
  }
}

export type CustomActions = ReturnType<typeof useCustomActions>
