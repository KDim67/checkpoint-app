/**
 * The user's own quick-action prompts: a small library of reusable prompts, each
 * tagged with the intent it should be sent under.
 *
 * Lifted out of AiStreamPanel with its JSX unchanged. State stays in the panel
 * and arrives as props: this unmounts every time it closes, so it must not own
 * anything worth keeping.
 */

import React from 'react'
import { Sparkles, Trash2, X } from 'lucide-react'
import type { CustomAction } from './types'

interface Props {
  customActions: CustomAction[]
  persistCustomActions: (list: CustomAction[]) => void
  caLabel: string
  setCaLabel: React.Dispatch<React.SetStateAction<string>>
  caPrompt: string
  setCaPrompt: React.Dispatch<React.SetStateAction<string>>
  caIntent: 'create' | 'analyze'
  setCaIntent: React.Dispatch<React.SetStateAction<'create' | 'analyze'>>
  handleAddCustomAction: () => void
  setShowCustomActionsModal: React.Dispatch<React.SetStateAction<boolean>>
}

export default function CustomActionsModal({
  customActions,
  persistCustomActions,
  caLabel,
  setCaLabel,
  caPrompt,
  setCaPrompt,
  caIntent,
  setCaIntent,
  handleAddCustomAction,
  setShowCustomActionsModal
}: Props) {
  return (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 110,
          background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)'
        }}>
          <div style={{
            background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', width: '100%', maxHeight: '90%',
            display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden'
          }}>
            <div style={{
              padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-surface-offset)',
              background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
            }}>
              <div className="row">
                <Sparkles size={14} style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                  My Quick Actions ({customActions.length})
                </span>
              </div>
              <button
                onClick={() => setShowCustomActionsModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Existing actions */}
              {customActions.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center', padding: 'var(--space-3)' }}>
                  No custom actions yet. Save the prompts you find yourself retyping, they'll appear in the ＋ menu.
                </div>
              ) : (
                customActions.map(a => (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px',
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-sm)'
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--color-text-base)' }}>{a.label}</span>
                        <span style={{
                          fontSize: '8px', fontWeight: 'bold', textTransform: 'uppercase', padding: '1px 6px', borderRadius: '6px',
                          background: a.intent === 'create' ? 'rgba(205,241,43,0.12)' : 'rgba(59,130,246,0.12)',
                          color: a.intent === 'create' ? 'var(--color-secondary)' : '#60a5fa'
                        }}>
                          {a.intent === 'create' ? 'Creates items' : 'Analyzes'}
                        </span>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {a.prompt}
                      </div>
                    </div>
                    <button
                      onClick={() => persistCustomActions(customActions.filter(x => x.id !== a.id))}
                      title="Delete action"
                      style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}

              {/* Add form */}
              <div style={{
                borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-3)',
                display: 'flex', flexDirection: 'column', gap: '6px'
              }}>
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>New quick action</span>
                <input
                  type="text"
                  value={caLabel}
                  onChange={e => setCaLabel(e.target.value)}
                  placeholder="Label (e.g. Write patch notes)"
                  style={{
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', fontSize: '11px', outline: 'none'
                  }}
                />
                <textarea
                  value={caPrompt}
                  onChange={e => setCaPrompt(e.target.value)}
                  placeholder="The full prompt to send…"
                  rows={3}
                  style={{
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', padding: '6px 8px',
                    fontSize: '11px', outline: 'none', resize: 'vertical', fontFamily: 'inherit'
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <select
                    value={caIntent}
                    onChange={e => setCaIntent(e.target.value as 'create' | 'analyze')}
                    title="'Creates items' routes through the structured board generator; 'Analyzes' guarantees a plain-text answer."
                    style={{
                      background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: '10px', outline: 'none', cursor: 'pointer'
                    }}
                  >
                    <option value="analyze">Analyzes (plain text)</option>
                    <option value="create">Creates board items</option>
                  </select>
                  <button
                    onClick={handleAddCustomAction}
                    disabled={!caLabel.trim() || !caPrompt.trim()}
                    style={{
                      background: caLabel.trim() && caPrompt.trim() ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
                      color: caLabel.trim() && caPrompt.trim() ? '#000' : 'var(--color-text-faint)',
                      border: 'none', borderRadius: 'var(--radius-sm)', padding: '5px 12px',
                      fontSize: '10px', fontWeight: 'bold', cursor: caLabel.trim() && caPrompt.trim() ? 'pointer' : 'default'
                    }}
                  >
                    Save Action
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
  )
}
