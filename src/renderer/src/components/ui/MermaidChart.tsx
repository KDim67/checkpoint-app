import React, { useState, useEffect, useId } from 'react'
import mermaid from 'mermaid'
import { themeToken, useThemeVersion } from '../../lib/themeTokens'

/** rebuilt from theme tokens per render; literals left every diagram dark blue */
function mermaidConfig() {
  const surface = themeToken('--color-surface-1', '#1b1f30')
  const canvas = themeToken('--color-surface-2', '#131622')
  const text = themeToken('--color-text-base', '#f1f5f9')
  const border = themeToken('--color-surface-offset', '#24293f')

  return {
    startOnLoad: false,
    // 'base' honours themeVariables, 'dark' ignores most of them
    theme: 'base' as const,
    /** strict: fences come from AI replies, synced notes and vaults, and loose HTML could reach electronAPI */
    securityLevel: 'strict' as const,
    themeVariables: {
      background: canvas,
      primaryColor: surface,
      primaryTextColor: text,
      primaryBorderColor: border,
      secondaryColor: themeToken('--color-secondary', '#cdf12b'),
      tertiaryColor: canvas,
      lineColor: themeToken('--color-text-faint', '#535e85'),
      textColor: text,
      mainBkg: surface,
      nodeBorder: border,
      nodeTextColor: text,
      edgeLabelBackground: canvas,
      fontFamily: themeToken('--font-sans', 'system-ui, sans-serif')
    }
  }
}

interface MermaidChartProps {
  code: string
  /** callers cap height in dense panels */
  style?: React.CSSProperties
}

/** wait for typing to settle, half-typed mermaid failed and logged per keystroke */
const SETTLE_MS = 300

export default function MermaidChart({ code, style }: MermaidChartProps): React.JSX.Element {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const reactId = useId()
  // useId's colons are invalid in a DOM id and CSS selector
  const elementId = `mermaid-${reactId.replace(/:/g, '')}`

  const themeVersion = useThemeVersion()

  // only render code the user stopped typing
  const [settledCode, setSettledCode] = useState(code)
  useEffect(() => {
    const timer = setTimeout(() => setSettledCode(code), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [code])

  useEffect(() => {
    let isMounted = true

    const renderChart = async (): Promise<void> => {
      try {
        // global config, so set right before the render
        mermaid.initialize(mermaidConfig())
        const { svg: renderedSvg } = await mermaid.render(elementId, settledCode)
        if (isMounted) {
          setSvg(renderedSvg)
          setError(null)
        }
      } catch (err) {
        // not logged, half-written diagrams fail routinely
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
  }, [settledCode, elementId, themeVersion])

  // keep the last good diagram while the next version is broken
  if (error && svg) {
    return (
      <div className="relative">
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
