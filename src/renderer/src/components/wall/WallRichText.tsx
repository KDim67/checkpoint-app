import React from 'react'
import { parseWallText, type TextSpan } from '../../../../shared/wallText'

/** styles nest outside in; addresses stay ctrl+clickable like the rest of the wall */
function Span({ span }: { span: TextSpan }) {
  let node: React.ReactNode = span.text
  if (span.code) node = <code className="wall-code">{node}</code>
  if (span.strike) node = <s>{node}</s>
  if (span.italic) node = <em>{node}</em>
  if (span.bold) node = <strong>{node}</strong>
  if (span.url) {
    node = <span data-wall-url={span.url} className="wall-text-link" title="Ctrl+click to open">{node}</span>
  }
  return <>{node}</>
}

/** one line a block; the parent sets size, colour and wrapping */
function WallRichText({ text }: { text: string }) {
  return (
    <>
      {parseWallText(text).map((block, i) => {
        const spans = block.spans.map((span, j) => <Span key={j} span={span} />)
        if (block.type === 'paragraph') {
          // a blank line still takes a line's height
          return <div key={i} data-wall-line>{spans.length > 0 ? spans : ' '}</div>
        }
        return (
          <div key={i} data-wall-line className="wall-list-item" style={{ paddingLeft: `${block.depth * 1.2}em` }}>
            <span className="wall-list-marker">{block.type === 'bullet' ? '•' : `${block.number}.`}</span>
            <span>{spans}</span>
          </div>
        )
      })}
    </>
  )
}

// text rarely changes while the wall redraws around it
export default React.memo(WallRichText)
