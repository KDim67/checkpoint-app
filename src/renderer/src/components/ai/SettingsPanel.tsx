/**
 * The inline settings drawer: temperature, response length and a per-session
 * system-prompt override.
 *
 * Lifted out of AiStreamPanel with its JSX unchanged, down to the indentation.
 * State stays in the panel and arrives as props: nothing here owns anything,
 * which is what makes it safe for this to unmount every time it closes.
 */

import React from 'react'
import { setNumberSetting } from '../../lib/settings'

interface Props {
  temperature: number
  setTemperature: React.Dispatch<React.SetStateAction<number>>
  maxTokens: number
  setMaxTokens: React.Dispatch<React.SetStateAction<number>>
  systemPromptOverride: string
  setSystemPromptOverride: React.Dispatch<React.SetStateAction<string>>
}

export default function SettingsPanel({
  temperature,
  setTemperature,
  maxTokens,
  setMaxTokens,
  systemPromptOverride,
  setSystemPromptOverride
}: Props) {
  return (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-surface-offset)',
          background: 'var(--color-surface-1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          flexShrink: 0
        }}>
          <div className="col">
            {/* Temperature Slider */}
            <div className="col-4px">
              <div className="row-between">
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Temperature
                </span>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-secondary)' }}>
                  {temperature.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  setTemperature(v)
                  setNumberSetting('ai_temperature', v).catch(() => {})
                }}
                style={{ width: '100%', accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
              />
            </div>

            {/* Max Tokens Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
              <div className="row-between">
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Max Response Tokens
                </span>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-secondary)' }}>
                  {maxTokens}
                </span>
              </div>
              <input
                type="range"
                min="256"
                max="8192"
                step="256"
                value={maxTokens}
                onChange={e => {
                  const v = parseInt(e.target.value)
                  setMaxTokens(v)
                  setNumberSetting('ai_max_tokens', v).catch(() => {})
                }}
                style={{ width: '100%', accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
              />
            </div>
          </div>
          <div className="col-4px">
            <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              System Prompt Override (optional)
            </span>
            <textarea
              value={systemPromptOverride}
              onChange={e => setSystemPromptOverride(e.target.value)}
              placeholder="Add extra instructions the AI will always follow in this session..."
              rows={2}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 8px',
                fontSize: '11px',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.4
              }}
            />
          </div>
        </div>
  )
}
