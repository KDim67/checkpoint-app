/** for models the catalogue doesn't list; state lives in useModelConfig */

import type { ModelConfig } from './useModelConfig'

interface Props {
  models: ModelConfig
}

export default function CustomModelPromptModal({ models }: Props) {
  const {
    customModelInput,
    setCustomModelInput,
    applyModel,
    setShowCustomModelPrompt
  } = models
  return (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1000,
          background: 'rgba(10, 12, 18, 0.75)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            padding: '16px', width: '100%', maxWidth: '320px',
            display: 'flex', flexDirection: 'column', gap: '12px',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-text-base)' }}>
              Enter Model Name
            </div>
            <div className="text-micro">
              Specify any custom cloud model (e.g. <code>gemini-2.5-flash</code>, <code>gpt-4o</code>, <code>deepseek-chat</code>).
            </div>
            <input
              type="text"
              value={customModelInput}
              onChange={e => setCustomModelInput(e.target.value)}
              placeholder="e.g. gemini-2.5-flash"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = customModelInput.trim()
                  if (val) applyModel(val)
                  setShowCustomModelPrompt(false)
                } else if (e.key === 'Escape') {
                  setShowCustomModelPrompt(false)
                }
              }}
              style={{
                width: '100%',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                fontSize: '11px',
                color: 'var(--color-text-base)',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={() => setShowCustomModelPrompt(false)}
                style={{
                  background: 'var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 12px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const val = customModelInput.trim()
                  if (val) await applyModel(val)
                  setShowCustomModelPrompt(false)
                }}
                style={{
                  background: 'var(--color-secondary)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 12px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
  )
}
