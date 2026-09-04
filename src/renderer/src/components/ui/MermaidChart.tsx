import React, { useState, useEffect, useId } from 'react'
import mermaid from 'mermaid'

// Mermaid keeps global config, so this runs once for the whole app. The colours
// are literals because mermaid resolves them at render time outside the DOM,
// where var(--token) has nothing to resolve against.
try {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
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

export default function MermaidChart({ code, style }: MermaidChartProps): React.JSX.Element {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const reactId = useId()
  // useId returns ':r0:' style ids; mermaid injects this into a DOM id and a
  // CSS selector, where the colons are invalid.
  const elementId = `mermaid-${reactId.replace(/:/g, '')}`

  useEffect(() => {
    let isMounted = true
    setError(null)

    const renderChart = async (): Promise<void> => {
      try {
        const { svg: renderedSvg } = await mermaid.render(elementId, code)
        if (isMounted) setSvg(renderedSvg)
      } catch (err) {
        console.error('Mermaid render error:', err)
        if (isMounted) {
          const errMsg = err instanceof Error ? err.message : String(err)
          setError(errMsg || 'Failed to render Mermaid chart')
        }
      }
    }

    renderChart()
    return () => {
      isMounted = false
    }
  }, [code, elementId])

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
