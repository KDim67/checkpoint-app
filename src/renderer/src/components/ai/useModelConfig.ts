/** held by the panel: the modals unmount, the header shows provider and model always */

import { useCallback, useEffect, useState } from 'react'
import { activateProvider, isLocalUrl, loadProviders, persistProviders, type AiProvider } from './aiProviders'
import { getNumberSetting, setStringSetting } from '../../lib/settings'
import * as ollamaApi from '../../data/ollama'
import * as cookbookApi from '../../data/cookbook'

export function useModelConfig() {
  const [selectedModel, setSelectedModel] = useState('llama3')
  const [localModels, setLocalModels] = useState<string[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState<string>('')
  const [showCookbookModal, setShowCookbookModal] = useState(false)
  const [showCustomModelPrompt, setShowCustomModelPrompt] = useState(false)
  const [customModelInput, setCustomModelInput] = useState('')
  const [pullingTag, setPullingTag] = useState<string | null>(null)
  const [pullProgress, setPullProgress] = useState<number>(0)

  // model list and ollama dropdown only for local endpoints; reruns on provider change
  const loadAiConfig = useCallback(async () => {
    try {
      const { providers: provs, activeId } = await loadProviders()
      setProviders(provs)
      setActiveProviderId(activeId)

      const active = provs.find(p => p.id === activeId)
      const baseUrl = active?.baseURL || ''
      const savedModel = active?.model || ''
      const isLocalEndpoint = isLocalUrl(baseUrl)

      if (savedModel) setSelectedModel(savedModel)

      setTemperature(await getNumberSetting('ai_temperature', 0.7))
      setMaxTokens(await getNumberSetting('ai_max_tokens', 2048))

      if (isLocalEndpoint) {
        // local: must be a model ollama has installed
        const list = await ollamaApi.listLocal().catch(() => [] as string[])
        if (list && list.length > 0) {
          setLocalModels(list)
          // heal the uninstalled default that 404s
          const savedInstalled = savedModel && list.includes(savedModel)
          if (!savedModel || !savedInstalled) {
            setSelectedModel(list[0])
            const next = provs.map(p => (p.id === activeId ? { ...p, model: list[0] } : p))
            setProviders(next)
            await persistProviders(next, activeId)
          }
        } else {
          setLocalModels([])
        }
      } else {
        // cloud: the profile's typed model
        setLocalModels([])
      }
    } catch (err) {
      console.warn('Failed to load AI config:', err)
    }
  }, [])

  useEffect(() => {
    loadAiConfig()
    const handler = (): void => { loadAiConfig() }
    window.addEventListener('checkpoint-ai-provider-changed', handler)
    return () => window.removeEventListener('checkpoint-ai-provider-changed', handler)
  }, [loadAiConfig])

  const handleSwitchProvider = useCallback(async (id: string) => {
    setActiveProviderId(id)
    await activateProvider(providers, id)
    await loadAiConfig()
  }, [providers, loadAiConfig])

  // keep the active profile, the source of truth, in sync
  const applyModel = useCallback(async (val: string) => {
    setSelectedModel(val)
    await setStringSetting('ai_model', val)
    setProviders(prev => {
      if (!activeProviderId) return prev
      const next = prev.map(p => (p.id === activeProviderId ? { ...p, model: val } : p))
      persistProviders(next, activeProviderId)
      return next
    })
  }, [activeProviderId])

  const handleModelChange = async (val: string) => {
    if (val === '__OPEN_COOKBOOK__') {
      setShowCookbookModal(true)
      refreshLocalModels()
      return
    }
    if (val === '__CUSTOM_MODEL__') {
      setCustomModelInput('')
      setShowCustomModelPrompt(true)
      return
    }
    await applyModel(val)
  }

  const refreshLocalModels = async () => {
    try {
      const list = await ollamaApi.listLocal()
      if (list && list.length > 0) {
        setLocalModels(list)
      }
    } catch (e) {
      console.warn('Failed to refresh local models:', e)
    }
  }

  const handlePullModel = async (tag: string) => {
    setPullingTag(tag)
    setPullProgress(0)
    const unsub = cookbookApi.onPullProgress(evt => {
      if (evt.percent !== undefined) setPullProgress(evt.percent)
    })
    try {
      await cookbookApi.pullModel(tag)
      await refreshLocalModels()
      await handleModelChange(tag)
    } catch (e) {
      console.error('Failed to pull model:', e)
    } finally {
      unsub()
      setPullingTag(null)
    }
  }

  return {
    selectedModel,
    localModels,
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    providers,
    activeProviderId,
    showCookbookModal,
    setShowCookbookModal,
    showCustomModelPrompt,
    setShowCustomModelPrompt,
    customModelInput,
    setCustomModelInput,
    pullingTag,
    pullProgress,
    handleSwitchProvider,
    applyModel,
    handleModelChange,
    handlePullModel
  }
}

export type ModelConfig = ReturnType<typeof useModelConfig>
