import React from 'react'
import { Info, Plus, Trash2, Copy } from 'lucide-react'
import MermaidChart from '../ui/MermaidChart'
import type { DialogueTool } from './useDialogueTool'

export default function DialoguePanel({
  tool,
  onCopy
}: {
  tool: DialogueTool
  onCopy: (text: string, label: string) => void
}) {
  const {
    dialogueNodes,
    nodeSpeaker,
    setNodeSpeaker,
    nodeText,
    setNodeText,
    nodeId,
    setNodeId,
    dialogueViewMode,
    setDialogueViewMode,
    dialogueChoiceInputs,
    setDialogueChoiceInputs,
    addDialogueNode,
    removeDialogueNode,
    addChoiceToNode,
    removeChoiceFromNode,
    compiledMermaid
  } = tool
  const copyToClipboard = onCopy

  return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="gamedev-info-banner">
          <Info size={15} className="gamedev-info-banner-icon" />
          <div>
            <strong>Dialogue & Quest Tree Builder:</strong> Structure branching narrative decisions and interactive flows. Export your quest nodes instantly as a standard Mermaid flowchart.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 'var(--space-4)' }}>
        
        {/* Editor Console */}
        <div style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)'
        }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Add Dialogue Node</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Unique Node ID</label>
              <input
                type="text"
                value={nodeId}
                onChange={e => setNodeId(e.target.value)}
                placeholder="e.g. quest_decline"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-2)',
                  fontSize: 'var(--text-xs)'
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Speaker Name</label>
              <input
                type="text"
                value={nodeSpeaker}
                onChange={e => setNodeSpeaker(e.target.value)}
                placeholder="e.g. Hero"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-2)',
                  fontSize: 'var(--text-xs)'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Dialogue Line</label>
            <textarea
              value={nodeText}
              onChange={e => setNodeText(e.target.value)}
              placeholder="e.g. I must find another path..."
              rows={2}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-2)',
                fontSize: 'var(--text-xs)',
                resize: 'none',
                fontFamily: 'inherit'
              }}
            />
          </div>

          <button
            onClick={addDialogueNode}
            style={{
              background: 'var(--color-secondary)',
              color: 'var(--color-text-inverted)',
              border: 'none',
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-1.5)'
            }}
          >
            <Plus size={14} />
            <span>Create Dialogue Node</span>
          </button>

          <hr style={{ border: '0', borderTop: '1px solid var(--color-surface-offset)', margin: 'var(--space-2) 0' }} />

          <h4 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', margin: '0 0 var(--space-2)' }}>Branching Connections</h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', overflowY: 'auto', maxHeight: '180px' }}>
            {dialogueNodes.map((node, nodeIdx) => (
              <div key={node.id} style={{
                padding: 'var(--space-2)',
                background: 'var(--color-surface-2)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <div className="row-between">
                  <strong style={{ fontSize: 'var(--text-xs)', color: 'var(--color-secondary)' }}>
                    {node.id} ({node.speaker})
                  </strong>
                  <button
                    onClick={() => removeDialogueNode(node.id)}
                    disabled={node.id === 'start'}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-error)',
                      cursor: 'pointer',
                      opacity: node.id === 'start' ? 0.3 : 1
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                  &ldquo;{node.text}&rdquo;
                </div>
                
                {/* Active Choices list */}
                {node.choices.map((c, choiceIdx) => (
                  <div key={choiceIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', background: 'var(--color-surface-1)', padding: '2px 6px', borderRadius: '4px', marginTop: '2px' }}>
                    <span>choice: <strong>{c.text}</strong> ➔ {c.nextId}</span>
                    <button
                      onClick={() => removeChoiceFromNode(nodeIdx, choiceIdx)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer' }}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {/* Add Choice Form */}
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <input
                    type="text"
                    placeholder="Choice text"
                    value={dialogueChoiceInputs[node.id]?.text || ''}
                    onChange={e => setDialogueChoiceInputs(prev => ({
                      ...prev,
                      [node.id]: {
                        text: e.target.value,
                        nextId: prev[node.id]?.nextId || ''
                      }
                    }))}
                    style={{
                      flex: 1,
                      background: 'var(--color-surface-1)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '10px'
                    }}
                  />
                  <select
                    value={dialogueChoiceInputs[node.id]?.nextId || ''}
                    onChange={e => setDialogueChoiceInputs(prev => ({
                      ...prev,
                      [node.id]: {
                        text: prev[node.id]?.text || '',
                        nextId: e.target.value
                      }
                    }))}
                    style={{
                      flex: 1,
                      background: 'var(--color-surface-1)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      borderRadius: '4px',
                      padding: '2px',
                      fontSize: '10px'
                    }}
                  >
                    <option value="">Next Node</option>
                    {dialogueNodes.map(opt => (
                      opt.id !== node.id && <option key={opt.id} value={opt.id}>{opt.id}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const inputVal = dialogueChoiceInputs[node.id]
                      if (inputVal && inputVal.text && inputVal.nextId) {
                        addChoiceToNode(nodeIdx, inputVal.text, inputVal.nextId)
                        setDialogueChoiceInputs(prev => ({
                          ...prev,
                          [node.id]: { text: '', nextId: '' }
                        }))
                      }
                    }}
                    style={{
                      background: 'var(--color-surface-offset)',
                      border: 'none',
                      borderRadius: '4px',
                      color: 'var(--color-text-base)',
                      cursor: 'pointer',
                      padding: '2px 8px',
                      fontSize: '10px'
                    }}
                  >
                    + Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Compiled Mermaid Output */}
        <div style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Dialogue Graph</h3>
            <div className="row">
              <div style={{ display: 'flex', gap: '2px', background: 'var(--color-surface-2)', padding: '2px', borderRadius: '6px', border: '1px solid var(--color-surface-offset)' }}>
                <button
                  onClick={() => setDialogueViewMode('visual')}
                  style={{
                    background: dialogueViewMode === 'visual' ? 'var(--color-secondary-muted)' : 'transparent',
                    color: dialogueViewMode === 'visual' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                    border: 'none',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: 'var(--weight-semibold)',
                    cursor: 'pointer',
                    transition: 'all 120ms ease'
                  }}
                >
                  Visual Chart
                </button>
                <button
                  onClick={() => setDialogueViewMode('code')}
                  style={{
                    background: dialogueViewMode === 'code' ? 'var(--color-secondary-muted)' : 'transparent',
                    color: dialogueViewMode === 'code' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                    border: 'none',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: 'var(--weight-semibold)',
                    cursor: 'pointer',
                    transition: 'all 120ms ease'
                  }}
                >
                  Mermaid Code
                </button>
              </div>
              <button
                onClick={() => copyToClipboard(compiledMermaid, 'Mermaid Flowchart')}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Copy size={10} />
                <span>Copy Code</span>
              </button>
            </div>
          </div>

          {dialogueViewMode === 'visual' ? (
            <MermaidChart style={{ maxHeight: '340px', boxSizing: 'border-box' }} code={compiledMermaid} />
          ) : (
            <pre style={{
              margin: 0,
              padding: 'var(--space-3)',
              background: 'var(--color-background)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-base)',
              flex: 1,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              maxHeight: '340px',
              border: '1px solid var(--color-surface-offset)'
            }}>
              {compiledMermaid}
            </pre>
          )}
        </div>
      </div>
      </div>
  )
}
