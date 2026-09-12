import React, { useState } from 'react'
import { Sparkles, Layout, ArrowRight, Copy, FileText, FileDown } from 'lucide-react'
import { useAppStore } from '../../../store/appStore'
import { useToast } from '../../ui/Toast'
import type { AiDialogueChoice, AiDialogueNode } from '../aiActionTypes'
import { asArray, asObject, str } from '../aiActionTypes'
import { AI_DIALOGUE_EVENT } from '../../gamedev/useDialogueTool'
import { faultTolerantParseJSON } from '../aiActionParse'
import * as appApi from '../../../data/app'

export default function CreateDialogueTreeActionBlock({ jsonString }: { jsonString: string }) {
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const parsed = faultTolerantParseJSON(jsonString)
  if (!parsed) return <pre>{jsonString}</pre>

  // `parsed` stays raw: it is handed verbatim to the Dialogue Builder and to the
  // JSON export, so it must not be reshaped. Only the preview reads `nodes`.
  const root = asObject(parsed) ?? {}
  const startNode = str(root.startNode)
  const nodes: AiDialogueNode[] = asArray(root.nodes).map(n => {
    const o = asObject(n) ?? {}
    return {
      id: str(o.id),
      speaker: str(o.speaker),
      text: str(o.text),
      choices: asArray(o.choices).map((c): AiDialogueChoice => {
        const co = asObject(c) ?? {}
        return { text: str(co.text), target: str(co.target) }
      })
    }
  })
  const PREVIEW_LIMIT = 3
  const visibleNodes = expanded ? nodes : nodes.slice(0, PREVIEW_LIMIT)

  const handleLoadTree = () => {
    window.dispatchEvent(new CustomEvent(AI_DIALOGUE_EVENT, { detail: parsed }))
    setLoaded(true)
    setView('gamedev')
  }

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(parsed, null, 2))
      .then(() => toast('Dialogue tree JSON copied!', { type: 'success' }))
      .catch(() => {})
  }

  const handleSaveJson = async () => {
    const fname = `dialogue_${(startNode || 'tree').replace(/\s+/g, '_')}.json`
    const success = await appApi.saveFile(fname, JSON.stringify(parsed, null, 2))
    if (success) toast('Dialogue tree saved as JSON!', { type: 'success' })
  }

  const handleSaveMd = async () => {
    let md = `# Dialogue Tree\n\nStart Node: \`${startNode || 'start'}\`\n\n---\n\n`
    for (const n of nodes) {
      md += `## Node: \`${n.id}\`\n\n**${n.speaker || 'NPC'}:** "${n.text}"\n\n`
      if (Array.isArray(n.choices) && n.choices.length > 0) {
        md += `**Player Choices:**\n\n`
        for (const c of n.choices) md += `- "${c.text}" → \`${c.target}\`\n`
        md += '\n'
      }
      md += '---\n\n'
    }
    const success = await appApi.saveFile('dialogue_tree.md', md)
    if (success) toast('Dialogue tree saved as Markdown!', { type: 'success' })
  }

  const iconBtn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--color-text-muted)', borderRadius: 'var(--radius-sm)', padding: '4px 10px',
    fontSize: '10px', fontWeight: 'bold', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '5px'
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(18, 10, 32, 0.97), rgba(10, 5, 20, 0.99))',
      border: '1px solid rgba(168, 85, 247, 0.3)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      margin: '12px 0',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.35)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', fontWeight: 'bold', color: '#a855f7' }}>
          <Sparkles size={14} />
          <span>Branching Dialogue &amp; Quest Flow</span>
        </div>
        <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)', padding: '2px 8px', borderRadius: '10px' }}>
          {nodes.length} node{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Node List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
        {visibleNodes.map((n, idx) => (
          <div key={idx} style={{
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(168,85,247,0.15)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 10px'
          }}>
            {/* Speaker chip + node ID */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <span style={{
                fontSize: '9px', background: 'rgba(168,85,247,0.2)',
                border: '1px solid rgba(168,85,247,0.4)', color: 'var(--color-accent-ai-soft)',
                padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold'
              }}>{n.speaker || 'NPC'}</span>
              <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}>id: {n.id}</span>
            </div>
            {/* Dialogue text */}
            <div style={{ fontSize: '11px', color: '#e4e4e7', lineHeight: 1.5, marginBottom: Array.isArray(n.choices) && n.choices.length > 0 ? '6px' : '0' }}>
              &ldquo;{n.text}&rdquo;
            </div>
            {/* Choices with target arrows */}
            {Array.isArray(n.choices) && n.choices.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {n.choices.map((c, ci) => (
                  <span key={ci} style={{
                    fontSize: '9px', background: 'rgba(168,85,247,0.1)',
                    color: 'var(--color-accent-ai-soft)', padding: '2px 7px', borderRadius: '4px',
                    border: '1px solid rgba(168,85,247,0.25)',
                    display: 'flex', alignItems: 'center', gap: '4px'
                  }}>
                    <span>{c.text}</span>
                    <ArrowRight size={8} style={{ opacity: 0.6 }} />
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#a78bfa', fontSize: '8px' }}>{c.target}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Expand/collapse toggle */}
      {nodes.length > PREVIEW_LIMIT && (
        <button
          onClick={() => setExpanded(prev => !prev)}
          style={{ background: 'none', border: 'none', color: 'var(--color-accent-ai)', fontSize: '11px', cursor: 'pointer', padding: '2px 0', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          {expanded
            ? `▲ Collapse (${nodes.length} nodes total)`
            : `▼ Show all ${nodes.length} nodes (${nodes.length - PREVIEW_LIMIT} hidden)`}
        </button>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid rgba(168,85,247,0.15)', paddingTop: '10px', justifyContent: 'flex-end' }}>
        <button
          onClick={handleCopyJson}
          style={iconBtn}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <Copy size={11} /> <span>Copy JSON</span>
        </button>
        <button
          onClick={handleSaveJson}
          style={iconBtn}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <FileDown size={11} /> <span>Save .json</span>
        </button>
        <button
          onClick={handleSaveMd}
          style={iconBtn}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <FileText size={11} /> <span>Save .md</span>
        </button>
        <button
          onClick={handleLoadTree}
          style={{
            // Once loaded this is a plain surface, not a white veil: the veil
            // was invisible in the light theme, and so was the white on it.
            background: loaded ? 'var(--color-surface-offset)' : 'var(--color-accent-ai)',
            border: 'none',
            color: loaded ? 'var(--color-text-muted)' : 'var(--color-on-accent)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 12px', fontSize: '10px', fontWeight: 'bold',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px'
          }}
          onMouseEnter={e => { if (!loaded) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-ai-hover)' }}
          onMouseLeave={e => { if (!loaded) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-ai)' }}
        >
          <Layout size={11} />
          <span>{loaded ? 'Loaded in Game Dev' : 'Load into Dialogue Builder'}</span>
          <ArrowRight size={10} />
        </button>
      </div>
    </div>
  )
}
