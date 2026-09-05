import React, { useState, useEffect, useId } from 'react'
import mermaid from 'mermaid'

// Mermaid keeps global config, so this runs once for the whole app. The colours
// are literals because mermaid resolves them at render time outside the DOM,
// where var(--token) has nothing to resolve against.
try {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    /**
     * Diagrams are rendered with `dangerouslySetInnerHTML`, and the text they
     * are built from is not always the user's own: a ```mermaid fence can
     * arrive in an AI reply, in a note synced from another machine, or in an
     * imported Obsidian vault.
     *
     * 'loose' lets that text carry raw HTML and click handlers, which in a
     * renderer holding `window.electronAPI` means the database and the file
     * system. 'strict' escapes the HTML and drops the handlers. The cost is
     * that HTML markup inside a node label shows as text, which is the right
     * trade for markup nobody in this app writes on purpose.
     */
    securityLevel: 'strict',
    themeVariables: {
      background: '#131622',
      primaryColor: '#1e45fc',
      secondaryColor: '#cdf12b',
      lineColor: '#535e85',
      textColor: '#f1f5f9'
    }
  })
} catch (err) {
  console.error('Failed to initialize mermaid:', err)
}

interface MermaidChartProps {
  code: string
  /** Merged over the frame style. Callers use it to cap height in dense panels. */
  style?: React.CSSProperties
}

/**
 * How long the code has to stop changing before it is worth rendering.
 *
 * The note preview re-renders on every keystroke, so a diagram being typed
 * arrives here character by character. Half of those are not valid mermaid, and
 * each one used to be rendered, fail, and log. Typing `B[Next]` reported a parse
 * error on every character before the closing bracket landed.
 */
const SETTLE_MS = 300

export default function MermaidChart({ code, style }: MermaidChartProps): React.JSX.Element {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const reactId = useId()
  // useId returns ':r0:' style ids; mermaid injects this into a DOM id and a
  // CSS selector, where the colons are invalid.
  const elementId = `mermaid-${reactId.replace(/:/g, '')}`

  // Only the code someone has stopped typing gets rendered.
  const [settledCode, setSettledCode] = useState(code)
  useEffect(() => {
    const timer = setTimeout(() => setSettledCode(code), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [code])

  useEffect(() => {
    let isMounted = true

    const renderChart = async (): Promise<void> => {
      try {
        const { svg: renderedSvg } = await mermaid.render(elementId, settledCode)
        if (isMounted) {
          setSvg(renderedSvg)
          setError(null)
        }
      } catch (err) {
        // Not logged. A diagram in progress fails here as a matter of course,
        // and the message below says so on screen where it belongs.
        if (isMounted) {
          const errMsg = err instanceof Error ? err.message : String(err)
          setError(errMsg || 'Failed to render Mermaid chart')
        }
      }
    }

    if (settledCode.trim()) renderChart()
    return () => {
      isMounted = false
    }
  }, [settledCode, elementId])

  // A diagram that rendered once stays on screen while the next version is
  // broken. Replacing a working picture with a stack trace on the way to the
  // next working picture is the wrong thing to show someone mid-edit.
  if (error && svg) {
    return (
      <div style={{ position: 'relative' }}>
        <div
          dangerouslySetInnerHTML={{ __html: svg }}
          style={{
            display: 'flex',
            justifyContent: 'center',
            background: 'var(--color-surface-2)',
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-warning)',
            overflowX: 'auto',
            opacity: 0.55,
            ...style
          }}
        />
        <div
          title={error}
          style={{
            position: 'absolute', top: 'var(--space-2)', right: 'var(--space-2)',
            background: 'var(--color-warning-muted)', color: 'var(--color-warning)',
            border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-full)',
            padding: '2px 10px', fontSize: 'var(--text-2xs)',
            fontWeight: 'var(--weight-semibold)', cursor: 'help'
          }}
        >
          Showing the last version that parsed
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <pre style={{
        color: 'var(--color-error)',
        background: 'var(--color-error-muted)',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap'
      }}>
        {error}
      </pre>
    )
  }

  if (!svg) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontStyle: 'italic', padding: 'var(--space-2)' }}>
        Rendering diagram…
      </div>
    )
  }

  return (
    <div
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-surface-2)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-surface-offset)',
        overflowX: 'auto',
        ...style
      }}
    />
  )
}
