import { Sparkles } from 'lucide-react'
import ContextPill from './ContextPill'
import ChatMessage from './ChatMessage'
import { parseThinkingAndContent } from './aiHelpers'
import type { AiStreamPanelState } from './useAiStreamPanel'

export default function AiChatHistory({ panel }: { panel: AiStreamPanelState }) {
  const {
    selectItem, messages, setInputValue, isStreaming, streamingText, contextItem, setContextItem,
    scrollContainerRef, isWaitingForFirstChunk, waitingLabel, copiedMsgIndex, handleScroll,
    handleRevert, handleRewrite, handleResend, handleSubmitWithText, handleCopyMessage
  } = panel
  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
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
          <ContextPill item={contextItem} onClear={() => { selectItem(null); setContextItem(null) }} />
        </div>
      )}

      {messages.length === 0 && !streamingText && !isWaitingForFirstChunk && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-xs)',
            gap: 'var(--space-3)',
            textAlign: 'center',
            padding: 'var(--space-6)'
          }}
        >
          <Sparkles size={26} className="text-accent" />
          <div>
            <div className="text-item-strong">
              Your project co-pilot
            </div>
            <div style={{ fontSize: '11px', marginTop: '2px' }}>
              It reads your board, creates and edits cards, and remembers your project.
            </div>
          </div>

          {/* Example chips. Make the invisible feature surface visible */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', maxWidth: '340px' }}>
            {[
              { label: '🗂 Set up a board for my project', action: () => handleSubmitWithText('Design a Kanban board for this project: propose the workflow COLUMNS (each with a fitting color) and seed each column with a few well-scoped starter cards (with tags and priorities).', { displayContent: 'Set up a board', intentHint: 'create' }) },
              { label: '✅ Move finished cards to Done', action: () => handleSubmitWithText('Move every card that is clearly finished to the Done column.') },
              { label: '💡 What should I work on next?', action: () => handleSubmitWithText('Review my current board and tell me what to work on next and why. Do NOT output JSON: give a prioritized, reasoned plain-text list.', { displayContent: 'What should I work on next?', intentHint: 'analyze' }) },
              { label: '📎 @-mention notes, files & PDFs', action: () => setInputValue('@') }
            ].map(chip => (
              <button
                key={chip.label}
                onClick={chip.action}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: '999px',
                  padding: '5px 12px',
                  fontSize: '10px',
                  fontWeight: 'var(--weight-medium)',
                  cursor: 'pointer',
                  transition: 'all 120ms ease'
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-secondary)'; e.currentTarget.style.color = 'var(--color-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-surface-offset)'; e.currentTarget.style.color = 'var(--color-text-base)' }}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <span style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>
            / commands · @ mentions · paste screenshots (👁 models) · Esc stops generation
          </span>
        </div>
      )}

      {messages.map((msg, index) => {
        // Check if subsequent message has JSON entities that can be reverted
        const nextMsg = messages[index + 1]
        const hasRevertAction = !!(
          nextMsg &&
          nextMsg.role === 'assistant' &&
          nextMsg.content.includes('```json')
        )

        return (
          <ChatMessage
            key={index}
            message={msg}
            messageIndex={index}
            onResend={handleResend}
            onRewrite={handleRewrite}
            onRevert={handleRevert}
            onCopy={handleCopyMessage}
            isCopied={copiedMsgIndex === index}
            // Committed messages are final. The blinking cursor belongs ONLY to
            // the live streaming preview below, never to already-written messages.
            isStreaming={false}
            hasRevertAction={hasRevertAction}
            actionsLocked={isStreaming}
          />
        )
      })}

      {/* "Thinking…" indicator while waiting for first chunk */}
      {isWaitingForFirstChunk && !streamingText && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', width: '100%' }}>
          <div style={{
            width: '24px', height: '24px', borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            background: 'var(--color-secondary-muted)', color: 'var(--color-secondary)',
            border: '1px solid var(--color-secondary)'
          }}>
            <Sparkles size={12} fill="currentColor" />
          </div>
          <div style={{
            background: 'var(--color-surface-2)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-3) var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-secondary)', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', animationDelay: '0s' }} />
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-secondary)', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-secondary)', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
            </span>
            <span>{waitingLabel}</span>
          </div>
        </div>
      )}

      {/* Streaming text preview bubble */}
      {streamingText && (() => {
        const { thinking, content } = parseThinkingAndContent(streamingText)
        return (
          <ChatMessage
            message={{ role: 'assistant', content, thinking: thinking || undefined }}
            isStreaming
          />
        )
      })()}
    </div>
  )
}
