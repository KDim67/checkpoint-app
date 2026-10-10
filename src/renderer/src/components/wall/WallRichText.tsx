import React, { type CSSProperties } from 'react'
import { parseWallText, type TextSpan } from '../../../../shared/wallText'
import { fontCssFamily } from './wallButtons'

/** styles nest outside in; addresses stay ctrl+clickable like the rest of the wall */
function Span({ span }: { span: TextSpan }) {
  let node: React.ReactNode = span.text
  if (span.code) node = <code className="wall-code">{node}</code>
  if (span.strike) node = <s>{node}</s>
  if (span.underline) node = <u>{node}</u>
  if (span.italic) node = <em>{node}</em>
  if (span.bold) node = <strong>{node}</strong>
  // a word's own colour, size and face; its size is a multiple of the box's, so it follows the box
  const look: CSSProperties = {
    ...(span.color ? { color: span.color } : {}),
    ...(span.size !== undefined ? { fontSize: `${span.size}em` } : {}),
    ...(span.font ? { fontFamily: fontCssFamily(span.font) } : {})
  }
  if (Object.keys(look).length > 0) node = <span style={look}>{node}</span>
  if (span.url) {
    node = <span data-wall-url={span.url} className="wall-text-link" title="Ctrl+click to open">{node}</span>
  }
  return <>{node}</>
}

/** one line a block; the parent sets size, colour and wrapping, and a line may set its own alignment */
function WallRichText({ text }: { text: string }) {
  return (
    <>
      {parseWallText(text).map((block, i) => {
        const spans = block.spans.map((span, j) => <Span key={j} span={span} />)
        const align = block.align ? { textAlign: block.align } : undefined
        if (block.type === 'paragraph') {
          // a blank line still takes a line's height
          return <div key={i} data-wall-line style={align}>{spans.length > 0 ? spans : ' '}</div>
        }
        return (
          <div key={i} data-wall-line className="wall-list-item" style={{ paddingLeft: `${block.depth * 1.2}em`, ...align }}>
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
