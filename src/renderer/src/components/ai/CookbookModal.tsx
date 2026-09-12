/**
 * The model cookbook: the curated catalogue alongside what Ollama actually has
 * installed, with pull progress for the ones it does not.
 *
 * Lifted out of AiStreamPanel with its JSX unchanged, down to the indentation.
 * State lives in useModelConfig and arrives as one `models` prop: nothing here
 * owns anything, which is what makes it safe for this to unmount every time it
 * closes.
 */

import { BookOpen, Download, RefreshCw } from 'lucide-react'
import ChatPanelModal from './ChatPanelModal'
import catalogData from '../../../../shared/catalog.json'
import type { ModelConfig } from './useModelConfig'

interface Props {
  models: ModelConfig
}

export default function CookbookModal({ models }: Props) {
  const {
    selectedModel,
    localModels,
    pullingTag,
    pullProgress,
    handleModelChange,
    handlePullModel,
    setShowCookbookModal
  } = models
  return (
    <ChatPanelModal
      icon={<BookOpen size={14} style={{ color: 'var(--color-secondary)' }} />}
      title="Model Cookbook"
      onClose={() => setShowCookbookModal(false)}
    >
      {/* Models List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {/* Local Installed Models Section */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
            Installed Local Models
          </div>
          {(() => {
            const effectiveModels = Array.from(new Set([
              ...localModels,
              ...(selectedModel ? [selectedModel] : [])
            ]))
            if (effectiveModels.length === 0) {
              return <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No local Ollama models detected.</div>
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {effectiveModels.map(m => {
                  const isSelected = selectedModel === m
                  return (
                    <div
                      key={m}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: isSelected ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '11px'
                      }}
                    >
                      <span style={{ fontWeight: isSelected ? 'bold' : 'normal', color: isSelected ? 'var(--color-secondary)' : 'var(--color-text-base)' }}>
                        {m}
                      </span>
                      <button
                        onClick={() => { handleModelChange(m); setShowCookbookModal(false) }}
                        style={{
                          background: isSelected ? 'var(--color-secondary)' : 'var(--color-surface-1)',
                          color: isSelected ? '#000' : 'var(--color-text-base)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          padding: '2px 8px',
                          fontSize: '10px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        {isSelected ? 'Active' : 'Select'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>

        {/* Catalog Available Models */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
            Catalog Models
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {catalogData.map(cat => {
              const q4Tag = cat.variants?.q4?.ollamaTag || cat.id
              const effectiveModels = Array.from(new Set([...localModels, ...(selectedModel ? [selectedModel] : [])]))
              const isInstalled = effectiveModels.some(lm => {
                const normLm = lm.toLowerCase().replace(/[:-]/g, '')
                const normCatId = cat.id.toLowerCase().replace(/[:-]/g, '')
                return normLm.includes(normCatId) || normCatId.includes(normLm) || (cat.id.includes('gemma') && lm.toLowerCase().includes('gemma'))
              })
              const isPullingThis = pullingTag === q4Tag
              return (
                <div
                  key={cat.id}
                  style={{
                    padding: '8px 10px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                >
                  <div className="row-between">
                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--color-text-base)' }}>{cat.name}</span>
                    {isInstalled ? (
                      <button
                        onClick={() => {
                          const matched = effectiveModels.find(lm => {
                            const normLm = lm.toLowerCase().replace(/[:-]/g, '')
                            const normCatId = cat.id.toLowerCase().replace(/[:-]/g, '')
                            return normLm.includes(normCatId) || normCatId.includes(normLm) || (cat.id.includes('gemma') && lm.toLowerCase().includes('gemma'))
                          }) || q4Tag
                          handleModelChange(matched);
                          setShowCookbookModal(false)
                        }}
                        style={{ background: 'var(--color-surface-1)', color: 'var(--color-secondary)', border: '1px solid var(--color-secondary-muted)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        Select
                      </button>
                    ) : (
                      <button
                        disabled={isPullingThis}
                        onClick={() => handlePullModel(q4Tag)}
                        style={{ background: 'var(--color-primary)', color: 'var(--color-on-accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        {isPullingThis ? <RefreshCw size={10} className="spin" /> : <Download size={10} />}
                        <span>{isPullingThis ? `${pullProgress}%` : 'Download'}</span>
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: '1.3' }}>{cat.description}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </ChatPanelModal>
  )
}
