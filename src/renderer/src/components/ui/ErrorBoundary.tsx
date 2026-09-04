import React from 'react'
import { errorMessage } from '../../../../shared/errors'

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** Shown in the fallback so the user knows which part of the app failed. */
  label?: string
  /**
   * Changing this clears a caught error. Pass the active view id so navigating
   * away from a broken view recovers on its own. Without it, one bad render
   * would leave the boundary stuck showing the fallback for the rest of the
   * session even after the user moved somewhere else entirely.
   */
  resetKey?: string | number
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string
}

/**
 * Catches render-time errors so a single bad component can't blank the window.
 *
 * Checkpoint holds the user's logs, tasks and notes locally, and an uncaught
 * render error in Electron takes the whole window to white with no way back
 * except restarting the app, which reads as data loss even though nothing was
 * lost. Every view and side panel is wrapped in one of these instead.
 */
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Kept on console too: the details panel below is for the user, this is for
    // whoever is looking at DevTools when it happens.
    console.error('[ErrorBoundary]', this.props.label ?? 'app', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, componentStack: '' })
    }
  }

  private handleCopy = (): void => {
    const { error, componentStack } = this.state
    const report = [
      `Checkpoint, ${this.props.label ?? 'app'} error`,
      error?.stack || String(error),
      componentStack && `\nComponent stack:${componentStack}`
    ]
      .filter(Boolean)
      .join('\n')
    navigator.clipboard.writeText(report).catch(err => {
      console.error('[ErrorBoundary] Could not copy report:', err)
    })
  }

  private handleRetry = (): void => {
    this.setState({ error: null, componentStack: '' })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-8) var(--space-6)',
          height: '100%',
          textAlign: 'center'
        }}
      >
        <h3
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            margin: 0
          }}
        >
          {this.props.label ? `${this.props.label} hit an error` : 'Something went wrong'}
        </h3>

        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            margin: 0,
            maxWidth: '440px',
            lineHeight: 1.5
          }}
        >
          The rest of Checkpoint is still running, and nothing you saved has been lost.
        </p>

        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-error)',
            background: 'var(--color-error-muted)',
            border: '1px solid var(--color-error-muted)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2) var(--space-3)',
            maxWidth: '560px',
            maxHeight: '120px',
            overflow: 'auto',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {errorMessage(error)}
        </code>

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <button className="btn-primary" onClick={this.handleRetry}>
            Try again
          </button>
          <button className="btn-secondary" onClick={this.handleCopy}>
            Copy details
          </button>
        </div>
      </div>
    )
  }
}
