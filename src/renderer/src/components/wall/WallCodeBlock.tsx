import React, { type CSSProperties } from 'react'
import { highlightCode, languageLabel } from '../../../../shared/wallCode'
import type { WallItem } from '../../../../shared/wallModel'
import WallTextEditor from './WallTextEditor'

interface Props {
  item: WallItem
  editing: boolean
  onTextChange: (id: string, text: string) => void
  onFinishEditing: () => void
}

/** the body's own padding and type, so the source doesn't move when writing starts */
const EDITOR: CSSProperties = {
  flex: 1, minHeight: 0, margin: 0, padding: '8px 10px', resize: 'none', border: 'none', outline: 'none',
  background: 'transparent', color: 'inherit', font: 'inherit', whiteSpace: 'pre', overflow: 'auto', tabSize: 2
}

/** source in a panel of its own, coloured by what each piece is, and written as plain text */
function WallCodeBlock({ item, editing, onTextChange, onFinishEditing }: Props) {
  return (
    <div className="wall-code-block wall-paper">
      <div className="wall-code-block-head">{languageLabel(item.language)}</div>
      {editing ? (
        <WallTextEditor
          code
          value={item.text ?? ''}
          onChange={text => onTextChange(item.id, text)}
          onFinish={onFinishEditing}
          style={EDITOR}
        />
      ) : (
        <pre className="wall-code-block-body">
          {item.text
            ? highlightCode(item.text, item.language).map((line, i) => (
                // a blank line still takes a line's height
                <div key={i}>
                  {line.length === 0 ? ' ' : line.map((token, j) => (token.type
                    ? <span key={j} className={`wall-code-${token.type}`}>{token.text}</span>
                    : <React.Fragment key={j}>{token.text}</React.Fragment>))}
                </div>
              ))
            : <span className="wall-code-block-empty">Double-click to write code</span>}
        </pre>
      )}
    </div>
  )
}

// source rarely changes while the wall redraws around it
export default React.memo(WallCodeBlock)
