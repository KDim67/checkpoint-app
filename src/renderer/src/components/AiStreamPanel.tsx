import React, { useState, useEffect, useRef } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import type { Item } from '../../../shared/types'
import ContextPill from './ai/ContextPill'
import ChatMessage from './ai/ChatMessage'
import ChatInput from './ai/ChatInput'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export default function AiStreamPanel() {
  const selectedItemId = useAppStore(s => s.selectedItemId)
  const selectItem = useAppStore(s => s.selectItem)
  const activeContext = useAppStore(s => s.activeContext)

  // Chat message history
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')

  // Context pre-seeding
  const [contextItem, setContextItem] = useState<Item | null>(null)

  // Configuration settings loaded from DB
  const [selectedModel, setSelectedModel] = useState('llama3')
  const [localModels, setLocalModels] = useState<string[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [useOllamaSelector, setUseOllamaSelector] = useState(false)

  // Buffering and throttling references
  const chunkBufferRef = useRef('')
  const animationFrameRef = useRef<number | null>(null)
  const lastUpdateRef = useRef(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 1. Fetch Context Item details when selectedItemId changes
  useEffect(() => {
    if (!selectedItemId) {
      setContextItem(null)
      return
    }

    const loadContextDetails = async () => {
      try {
        const res = await window.electronAPI.db.searchItems({
          query: selectedItemId,
          context: activeContext
        })
        const found = res.items.find(i => i.id === selectedItemId)
        if (found) {
          setContextItem(found)
        }
      } catch (err) {
        console.error('Failed to load pre-seeded AI context item:', err)
      }
    }
    loadContextDetails()
  }, [selectedItemId, activeContext])

  // 2. Load Configuration and Local Models on mount
  useEffect(() => {
    const loadAiConfig = async () => {
      try {
        const dbModel = await window.electronAPI.db.getSetting('ai_model')
        const dbTemp = await window.electronAPI.db.getSetting('ai_temperature')
        const dbMaxTokens = await window.electronAPI.db.getSetting('ai_max_tokens')

        if (dbModel) setSelectedModel(dbModel as string)
        if (dbTemp !== null) setTemperature(Number(dbTemp))
        if (dbMaxTokens !== null) setMaxTokens(Number(dbMaxTokens))

        // Check local models from Ollama
        const list = await window.electronAPI.ollama.listLocal()
        if (list && list.length > 0) {
          setLocalModels(list)
          setUseOllamaSelector(true)
          // Default to the first local model if selectedModel is empty
          if (!dbModel) {
            setSelectedModel(list[0])
            await window.electronAPI.db.setSetting('ai_model', list[0])
          }
        } else {
          setUseOllamaSelector(false)
        }
      } catch {
        // Fallback to text input model selector if Ollama is not running/available
        setUseOllamaSelector(false)
      }
    }
    loadAiConfig()
  }, [])

  // 3. Scroll to bottom
  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingText])

  // 4. Mount IPC Streaming Listeners with cleanups to prevent leaks
  useEffect(() => {
    const unsubscribeChunk = window.electronAPI.ai.onChunk((chunk) => {
      chunkBufferRef.current += chunk

      const now = Date.now()
      if (now - lastUpdateRef.current > 50) {
        lastUpdateRef.current = now
        setStreamingText(chunkBufferRef.current)
      } else if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(() => {
          animationFrameRef.current = null
          setStreamingText(chunkBufferRef.current)
        })
      }
    })

    const unsubscribeDone = window.electronAPI.ai.onDone(() => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      const finalAssistantResponse = chunkBufferRef.current
      setMessages(prev => [...prev, { role: 'assistant', content: finalAssistantResponse }])
      setStreamingText('')
      chunkBufferRef.current = ''
      setIsStreaming(false)
    })

    const unsubscribeError = window.electronAPI.ai.onError((errMessage) => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      const errText = `\n\n**Error:** ${errMessage}`
      const finalAssistantResponse = chunkBufferRef.current + errText
      setMessages(prev => [...prev, { role: 'assistant', content: finalAssistantResponse }])
      setStreamingText('')
      chunkBufferRef.current = ''
      setIsStreaming(false)
    })

    return () => {
      unsubscribeChunk()
      unsubscribeDone()
      unsubscribeError()
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  const handleModelChange = async (val: string) => {
    setSelectedModel(val)
    await window.electronAPI.db.setSetting('ai_model', val)
  }

  // 5. Submit Query
  const handleSubmit = async () => {
    if (!inputValue.trim() || isStreaming) return

    const userMessage: Message = { role: 'user', content: inputValue.trim() }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInputValue('')
    setIsStreaming(true)
    chunkBufferRef.current = ''
    setStreamingText('')

    // Seed context as a system instruction if preset
    const systemPrompt: Message[] = []
    if (contextItem) {
      systemPrompt.push({
        role: 'system',
        content: `Active Context Item details to help answer the user:\nType: ${contextItem.type}\nTitle: ${contextItem.title}\nContent:\n${contextItem.body || '[No description]'}\n\nUse this context item for answering the user's questions.`
      })
    }

    try {
      const params = {
        model: selectedModel,
        messages: [...systemPrompt, ...nextMessages],
        temperature,
        maxTokens
      }
      await window.electronAPI.ai.startStream(params)
    } catch (err) {
      const error = err as Error
      setIsStreaming(false)
      setMessages(prev => [...prev, { role: 'assistant', content: `**Failed to initiate stream:** ${error.message || String(err)}` }])
    }
  }

  const handleAbort = async () => {
    try {
      await window.electronAPI.ai.abortStream()
      // Let the main thread know we want to stop
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      const finalAssistantResponse = chunkBufferRef.current + '\n\n*Stream cancelled by user.*'
      setMessages(prev => [...prev, { role: 'assistant', content: finalAssistantResponse }])
      setStreamingText('')
      chunkBufferRef.current = ''
      setIsStreaming(false)
    } catch (err) {
      console.error('Failed to abort stream:', err)
    }
  }

  const handleClearChat = () => {
    setMessages([])
    setStreamingText('')
    chunkBufferRef.current = ''
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}
    >
      {/* Selector Header controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: '1px solid var(--color-surface-offset)',
          background: 'var(--color-surface-2)',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1 }}>
          <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', flexShrink: 0 }}>
            Model
          </span>
          {useOllamaSelector ? (
            <select
              value={selectedModel}
              onChange={e => handleModelChange(e.target.value)}
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                fontSize: '11px',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '160px'
              }}
            >
              {localModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={selectedModel}
              onChange={e => handleModelChange(e.target.value)}
              placeholder="e.g. llama3"
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                fontSize: '11px',
                outline: 'none',
                maxWidth: '140px'
              }}
            />
          )}
        </div>

        {/* Clear chat icon */}
        <button
          onClick={handleClearChat}
          disabled={messages.length === 0 && !streamingText}
          style={{
            background: 'transparent',
            border: 'none',
            color: messages.length === 0 && !streamingText ? 'var(--color-text-faint)' : 'var(--color-text-muted)',
            cursor: messages.length === 0 && !streamingText ? 'default' : 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center'
          }}
          onMouseEnter={e => {
            if (messages.length > 0 || streamingText) e.currentTarget.style.color = 'var(--color-text-base)'
          }}
          onMouseLeave={e => {
            if (messages.length > 0 || streamingText) e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
          title="Clear conversation history"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Main chat history list */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)'
        }}
      >
        {/* Context pre-seeded pill if active */}
        {contextItem && (
          <div style={{ flexShrink: 0 }}>
            <ContextPill item={contextItem} onClear={() => selectItem(null)} />
          </div>
        )}

        {messages.length === 0 && !streamingText && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              gap: 'var(--space-2)',
              textAlign: 'center',
              padding: 'var(--space-6)'
            }}
          >
            <Sparkles size={24} style={{ color: 'var(--color-secondary)' }} />
            <span>
              Pre-seed task context from details view, click "AI Assist", or write a question below.
            </span>
          </div>
        )}

        {messages.map((msg, index) => (
          <ChatMessage key={index} message={msg} />
        ))}

        {/* Streaming text preview bubble */}
        {streamingText && (
          <ChatMessage message={{ role: 'assistant', content: streamingText }} />
        )}
      </div>

      {/* Input panel at bottom */}
      <div
        style={{
          padding: 'var(--space-4)',
          borderTop: '1px solid var(--color-surface-offset)',
          background: 'var(--color-surface-1)',
          flexShrink: 0
        }}
      >
        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          onAbort={handleAbort}
          isStreaming={isStreaming}
          contextItem={contextItem}
        />
      </div>
    </div>
  )
}
