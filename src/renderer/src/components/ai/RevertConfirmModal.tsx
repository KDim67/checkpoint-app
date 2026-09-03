/**
 * Confirmation before undoing what the assistant created. Destructive and not
 * recoverable, so it names every card and column it is about to remove.
 *
 * Lifted out of AiStreamPanel with its JSX unchanged, down to the indentation.
 * State stays in the panel and arrives as props: nothing here owns anything,
 * which is what makes it safe for this to unmount every time it closes.
 */

import React from 'react'
import { Trash2 } from 'lucide-react'
import type { Message } from './types'

interface Props {
  revertConfirmData: { cardTitles: string[]; columnNames: string[]; index: number }
  setRevertConfirmData: React.Dispatch<React.SetStateAction<{ cardTitles: string[]; columnNames: string[]; index: number } | null>>
  revertAICreatedEntities: (cardTitles: string[], columnNames: string[]) => Promise<void>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
}

export default function RevertConfirmModal({
  revertConfirmData,
  setRevertConfirmData,
  revertAICreatedEntities,
  setMessages
}: Props) {
  return (
        <div className="modal-overlay" onClick={() => setRevertConfirmData(null)}>
          <style>{`
            .modal-overlay {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0, 0, 0, 0.75);
              z-index: 2000;
              display: flex;
              align-items: center;
              justify-content: center;
              backdrop-filter: blur(5px);
              animation: modal-fade-in 150ms ease-out;
            }
            .revert-modal {
              width: 440px;
              background: var(--color-surface-1);
              border: 1px solid var(--color-surface-offset);
              border-radius: var(--radius-lg);
              padding: var(--space-6);
              display: flex;
              flex-direction: column;
              gap: var(--space-4);
              box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
              animation: modal-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
            }
          `}</style>
          <div className="revert-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Trash2 style={{ color: 'var(--color-error)' }} size={22} />
              <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
                Revert Board State
              </h2>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', margin: 0, lineHeight: 1.5 }}>
                Are you sure you want to revert the board to the state before this message was sent?
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                This will **permanently delete** any columns or cards created during this conversation turn, restore the prior snapshot, and truncate the chat history.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button
                onClick={() => setRevertConfirmData(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-base)',
                  padding: '6px 14px',
                  fontSize: 'var(--text-xs)',
                  cursor: 'pointer',
                  fontWeight: 'var(--weight-medium)',
                  transition: 'background-color 150ms'
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-surface-2)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const data = revertConfirmData
                  setRevertConfirmData(null)
                  try {
                    await revertAICreatedEntities(data.cardTitles, data.columnNames)
                    setMessages(prev => prev.slice(0, data.index))
                  } catch (err) {
                    console.error('Failed to revert AI changes:', err)
                  }
                }}
                style={{
                  background: 'var(--color-error)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-inverted)',
                  padding: '6px 14px',
                  fontSize: 'var(--text-xs)',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  transition: 'opacity 150ms'
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                Revert Changes
              </button>
            </div>
          </div>
        </div>
  )
}
