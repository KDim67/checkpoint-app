import React, { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeBlock from '../ui/CodeBlock'
import { Sparkles, User, Mail, BookOpen, RefreshCw, Pencil, Copy, Check, Trash2, FileText, Brain } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { ColumnConfig } from '../../lib/boardConfig'
import type { Item } from '@shared/types'
import { linkifyCardTitles, normalizeCardJson, normalizeColumnJson, parseBatchBoardJson } from './aiActionParse'
import BatchBoardActionBlock from './actions/BatchBoardActionBlock'
import UpdateBoardActionBlock from './actions/UpdateBoardActionBlock'
import ConfigureBoardActionBlock from './actions/ConfigureBoardActionBlock'
import CreateTaskActionBlock from './actions/CreateTaskActionBlock'
import CreateColumnActionBlock from './actions/CreateColumnActionBlock'
import CreatePlanActionBlock from './actions/CreatePlanActionBlock'
import CreateDialogueTreeActionBlock from './actions/CreateDialogueTreeActionBlock'
import { useBoardTitles } from './useBoardTitles'
import * as appApi from '../../data/app'

interface ChatMessageProps {
  message: {
    role: 'system' | 'user' | 'assistant'
    content: string
    displayContent?: string
    thinking?: string
    mode?: string
    cheatsheets?: string[]
    /** Attached note titles (knowledge docs pulled from the Notes feature). */
    notes?: string[]
    /** Attached workspace file relative paths. */
    files?: string[]
    /** Attached images as data URLs (vision-capable models). */
    images?: string[]
    timestamp?: number
    boardSnapshot?: {
      columns: ColumnConfig[]
      cards: Item[]
    }
  }
  messageIndex?: number
  onResend?: (index: number) => void
  onRewrite?: (newContent: string, index: number) => void
  onRevert?: (index: number) => void
  onCopy?: (content: string, index: number) => void
  isCopied?: boolean
  isStreaming?: boolean
  hasRevertAction?: boolean
  /** The panel's global streaming flag. Compared by React.memo so committed
   *  messages re-render (fresh handler closures) when streaming toggles. */
  actionsLocked?: boolean
}

function ChatMessage({ message, messageIndex, onResend, onRewrite, onRevert, onCopy, isCopied, isStreaming, hasRevertAction }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  // Card-title linkification only for committed assistant messages (streaming
  // text shifts constantly; user text is their own words). Memoized: the
  // regex sweep over up to 80 titles must not run on unrelated re-renders.
  const boardTitles = useBoardTitles(activeWorkspace || 'default', !isUser && !isStreaming)
  const renderedContent = React.useMemo(
    () => (!isUser && !isStreaming) ? linkifyCardTitles(message.content, boardTitles) : message.content,
    [isUser, isStreaming, message.content, boardTitles]
  )
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(message.displayContent || message.content)
  const [showThinking, setShowThinking] = useState(false)

  useEffect(() => {
    setEditText(message.displayContent || message.content)
  }, [message.content, message.displayContent])

  const handleSaveEdit = () => {
    if (editText.trim() && onRewrite) {
      onRewrite(editText.trim(), messageIndex ?? 0)
      setIsEditing(false)
    }
  }

  const relativeTime = (ts?: number) => {
    if (!ts) return ''
    const diff = Date.now() - ts
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(ts).toLocaleDateString()
  }

  if (message.role === 'system') return null // Do not render system instructions in bubbles

  return (
    // Timestamp/copy reveal is pure CSS (.chat-msg-row:hover). A state-driven
    // hover re-rendered the whole message subtree (ReactMarkdown + action
    // blocks) on every mouse crossing, which made the chat visibly stutter.
    <div
      className="chat-msg-row"
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      {/* Role Avatar */}
      <div
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: isUser ? 'var(--color-primary)' : 'var(--color-secondary-muted)',
          color: isUser ? 'var(--color-text-inverted)' : 'var(--color-secondary)',
          border: isUser ? 'none' : '1px solid var(--color-secondary)'
        }}
      >
        {isUser ? <User size={12} /> : <Sparkles size={12} fill="currentColor" />}
      </div>

      {/* Bubble Content */}
      <div
        style={{
          background: isUser ? 'var(--color-surface-offset)' : 'var(--color-surface-2)',
          border: isUser ? '1px solid var(--color-surface-offset)' : '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)',
          maxWidth: '88%',
          fontSize: 'var(--text-xs)',
          lineHeight: 1.6,
          color: 'var(--color-text-base)',
          boxSizing: 'border-box',
          overflow: 'hidden',
          boxShadow: isUser ? 'none' : '0 2px 8px rgba(0, 0, 0, 0.15)',
          position: 'relative'
        }}
        className={isUser ? undefined : 'markdown-body'}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: (message.mode || (message.cheatsheets && message.cheatsheets.length > 0)) ? '6px' : '0px' }}>
          {message.mode === 'email_draft' && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'var(--color-secondary-muted)',
                border: '1px solid var(--color-secondary)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 8px',
                fontSize: '10px',
                fontWeight: 'bold',
                color: 'var(--color-secondary)'
              }}
            >
              <Mail size={12} />
              <span>Draft Email Request</span>
            </div>
          )}

          {message.cheatsheets && message.cheatsheets.map((csName, idx) => (
            <div
              key={idx}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 8px',
                fontSize: '10px',
                fontWeight: 'bold',
                color: 'var(--color-primary-soft)'
              }}
            >
              <BookOpen size={12} />
              <span>{csName}</span>
            </div>
          ))}

          {message.notes && message.notes.map((noteTitle, idx) => (
            <div
              key={`n-${idx}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                background: 'rgba(34, 197, 94, 0.14)', border: '1px solid rgba(34, 197, 94, 0.4)',
                borderRadius: 'var(--radius-sm)', padding: '2px 8px',
                fontSize: '10px', fontWeight: 'bold', color: 'var(--color-success-soft)'
              }}
            >
              <FileText size={12} />
              <span>{noteTitle}</span>
            </div>
          ))}

          {message.files && message.files.map((filePath, idx) => (
            <div
              key={`f-${idx}`}
              title={filePath}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                background: 'rgba(56, 189, 248, 0.14)', border: '1px solid rgba(56, 189, 248, 0.4)',
                borderRadius: 'var(--radius-sm)', padding: '2px 8px',
                fontSize: '10px', fontWeight: 'bold', color: 'var(--color-info)'
              }}
            >
              <FileText size={12} />
              <span>{filePath.split(/[\\/]/).pop()}</span>
            </div>
          ))}
        </div>

        {/* Attached images (vision input) */}
        {message.images && message.images.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
            {message.images.map((src, idx) => (
              <img
                key={idx}
                src={src}
                alt={`attachment ${idx + 1}`}
                style={{
                  width: '84px', height: '84px', objectFit: 'cover',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-surface-offset)',
                  cursor: 'zoom-in'
                }}
                onClick={e => {
                  // Simple lightbox: toggle between thumbnail and large preview
                  const img = e.currentTarget
                  const large = img.style.width !== '84px'
                  img.style.width = large ? '84px' : '260px'
                  img.style.height = large ? '84px' : 'auto'
                  img.style.cursor = large ? 'zoom-in' : 'zoom-out'
                }}
              />
            ))}
          </div>
        )}

        {isUser ? (
          <div>
            {isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: '220px' }}>
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '60px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-secondary)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    fontSize: '11px',
                    outline: 'none',
                    fontFamily: 'var(--font-sans)',
                    resize: 'vertical'
                  }}
                />
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setIsEditing(false)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-muted)',
                      padding: '2px 8px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    style={{
                      background: 'var(--color-secondary)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-inverted)',
                      padding: '2px 8px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Save & Submit
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.displayContent || message.content}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '6px', paddingTop: '4px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
              {/* Timestamp */}
              <span className="msg-hover-reveal" style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>
                {relativeTime(message.timestamp)}
              </span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {onRewrite && !isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--color-text-muted)', fontSize: '10px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 4px', borderRadius: '4px'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                    title="Edit prompt and resubmit"
                  >
                    <Pencil size={11} />
                    <span>Rewrite</span>
                  </button>
                )}
                {onResend && !isEditing && (
                  <button
                    onClick={() => onResend(messageIndex ?? 0)}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--color-secondary)', fontSize: '10px', fontWeight: 'bold',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 4px', borderRadius: '4px'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    title="Resend this prompt turn"
                  >
                    <RefreshCw size={11} />
                    <span>Resend</span>
                  </button>
                )}
                {hasRevertAction && onRevert && !isEditing && (
                  <button
                    onClick={() => {
                      onRevert(messageIndex ?? 0)
                    }}
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: 'var(--color-error)', fontSize: '10px', fontWeight: 'bold',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 4px', borderRadius: '4px'
                    }}
                    title="Undo board changes and rollback history"
                  >
                    <Trash2 size={11} />
                    <span>Revert</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative">
            {message.thinking && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                marginBottom: '10px',
                fontSize: '11px'
              }}>
                <button
                  onClick={() => setShowThinking(prev => !prev)}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    color: 'var(--color-secondary)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '5px',
                    fontSize: '10px', fontWeight: 'bold'
                  }}
                >
                  <Brain size={12} className="text-accent" />
                  <span>{showThinking ? 'Hide Thinking Process' : 'Show Thinking Process'}</span>
                  <span style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>
                    ({Math.ceil(message.thinking.length / 4)} tokens)
                  </span>
                </button>
                {showThinking && (
                  <div style={{
                    marginTop: '6px',
                    paddingTop: '6px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    fontStyle: 'italic',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px'
                  }}>
                    {message.thinking}
                  </div>
                )}
              </div>
            )}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={url => url}
              components={{
                a({ href, children }) {
                  // Internal card reference. Open the card's detail panel
                  if (href && href.startsWith('#card:')) {
                    const cardId = href.slice(6)
                    return (
                      <a
                        href={href}
                        onClick={e => { e.preventDefault(); useAppStore.getState().selectItem(cardId) }}
                        title="Open card details"
                        style={{ color: 'var(--color-secondary)', fontWeight: 600, textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }}
                      >
                        {children}
                      </a>
                    )
                  }
                  // External links open in the system browser, not inside the app
                  return (
                    <a
                      href={href}
                      onClick={e => {
                        e.preventDefault()
                        if (href) appApi.openExternal(href).catch(() => {})
                      }}
                      style={{ color: 'var(--color-primary)', cursor: 'pointer' }}
                    >
                      {children}
                    </a>
                  )
                },
                code({ className, children, ...props }) {
                  const match = /language-([^\s]+)/.exec(className || '')
                  const lang = match ? match[1] : ''
                  const rawContent = String(children)

                  // Step 1: Explicit language tag wins. Use the rich single-block UIs
                  // Checked before update_board: "configure_board" contains
                  // neither substring, but keeping the more specific tag first
                  // keeps the ordering obvious if either name ever changes.
                  if (lang === 'configure_board' || lang.includes('configure_board')) {
                    return <ConfigureBoardActionBlock jsonString={rawContent} dedupeKey={String(message.timestamp ?? messageIndex ?? '')} />
                  }
                  if (lang === 'update_board' || lang.includes('update_board')) {
                    return <UpdateBoardActionBlock jsonString={rawContent} dedupeKey={String(message.timestamp ?? messageIndex ?? '')} />
                  }
                  if (lang === 'create_card' || lang === 'create_task' || lang.includes('create_card') || lang.includes('create_task')) {
                    const normCard = normalizeCardJson(rawContent)
                    if (normCard) return <CreateTaskActionBlock jsonString={rawContent} />
                  }
                  if (lang === 'create_column' || lang.includes('create_column')) {
                    const normCol = normalizeColumnJson(rawContent)
                    if (normCol) return <CreateColumnActionBlock jsonString={rawContent} />
                  }
                  if (lang === 'create_plan' || lang.includes('create_plan')) {
                    return <CreatePlanActionBlock jsonString={rawContent} />
                  }
                  if (lang === 'create_dialogue_tree' || lang.includes('create_dialogue_tree')) {
                    return <CreateDialogueTreeActionBlock jsonString={rawContent} />
                  }

                  // Step 2: Generic JSON. Try batch (handles all AI output formats)
                  if (lang === 'json' || lang === 'create_batch' || lang === 'batch' || lang === '') {
                    const batch = parseBatchBoardJson(rawContent)
                    if (batch && (batch.columns.length > 0 || batch.cards.length > 0)) {
                      return <BatchBoardActionBlock jsonString={rawContent} />
                    }
                  }

                  // Step 3: Unlabelled fenced block. Try all parsers as a last resort
                  if (!lang || lang === 'json') {
                    const normCard = normalizeCardJson(rawContent)
                    if (normCard) return <CreateTaskActionBlock jsonString={rawContent} />
                    const normCol = normalizeColumnJson(rawContent)
                    if (normCol) return <CreateColumnActionBlock jsonString={rawContent} />
                  }

                  // Fallback: plain code block
                  const isBlock = className?.includes('language-') || String(children).includes('\n')
                  return isBlock ? (
                    <CodeBlock
                      language={match ? match[1] : undefined}
                      value={String(children).replace(/\n$/, '')}
                    />
                  ) : (
                    <code
                      className={className}
                      {...props}
                      style={{
                        background: 'var(--color-surface-2)',
                        padding: '2px 4px',
                        borderRadius: 'var(--radius-sm)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.9em',
                        color: 'var(--color-secondary)'
                      }}
                    >
                      {children}
                    </code>
                  )
                }
              }}
            >
              {renderedContent}
            </ReactMarkdown>

            {/* Blinking cursor at end of streaming message */}
            {isStreaming && (
              <span className="ai-streaming-cursor" />
            )}

            {/* Bottom row: timestamp + copy button */}
            <div
              className={`msg-meta-row ${isCopied ? 'force-visible' : ''}`}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: '6px', paddingTop: '4px'
              }}
            >
              <span className="msg-hover-reveal" style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>
                {relativeTime(message.timestamp)}
              </span>
              {onCopy && messageIndex !== undefined && (
                <button
                  onClick={() => onCopy(message.displayContent || message.content, messageIndex)}
                  className={`msg-hover-reveal ${isCopied ? 'force-visible' : ''}`}
                  style={{
                    background: 'transparent', border: 'none',
                    color: isCopied ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '2px 4px', borderRadius: '4px', fontSize: '10px'
                  }}
                  title="Copy response"
                >
                  {isCopied ? <Check size={11} /> : <Copy size={11} />}
                  <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
// Memoized on data props only: the panel re-renders on every keystroke, and
// re-rendering every committed message (ReactMarkdown + title linkify) made
// the chat visibly stutter. Handler props are recreated each render but only
// close over the message PREFIX up to this index, which never changes for a
// committed message. `actionsLocked` (the panel's isStreaming) is compared so
// handlers pick up fresh closures whenever streaming starts/stops.
export default React.memo(ChatMessage, (prev, next) =>
  prev.message === next.message &&
  prev.messageIndex === next.messageIndex &&
  prev.isCopied === next.isCopied &&
  prev.isStreaming === next.isStreaming &&
  prev.hasRevertAction === next.hasRevertAction &&
  prev.actionsLocked === next.actionsLocked
)
