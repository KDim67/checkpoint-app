import React, { useEffect, useState } from 'react'
import { Sparkles, CheckCircle2, ArrowRight, Check } from 'lucide-react'
import { useAppStore } from '../../../store/appStore'
import { useToast, useFailureReport } from '../../ui/Toast'
import { withLock } from '../../../lib/asyncMutex'
import { flushWallDoc, loadWallDoc, loadWallIndex, saveWallIndex } from '../../../lib/wallDoc'
import { createWall, createWallItem, setActiveWall, wallDocKey, type WallItem } from '../../../../../shared/wallModel'
import { connectWallItems, editWallItem } from '../../../../../shared/wallEdit'
import { parseWallDiagramJson } from '../aiActionParse'

export default function CreateWallDiagramActionBlock({ jsonString }: { jsonString: string }) {
  const report = useFailureReport()
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()

  const diagram = parseWallDiagramJson(jsonString)
  const sig = diagram
    ? `wall_diag::${activeWorkspace || 'default'}::${diagram.wallName || 'active'}::${diagram.items.map(i => i.id + i.text.slice(0, 12)).join(',')}`
    : ''

  const [phase, setPhase] = useState<'review' | 'committed'>(() => {
    try {
      return sig && localStorage.getItem(sig) === '1' ? 'committed' : 'review'
    } catch {
      return 'review'
    }
  })
  const [busy, setBusy] = useState(false)
  const [placedSummary, setPlacedSummary] = useState<string | null>(null)

  useEffect(() => {
    try {
      setPhase(sig && localStorage.getItem(sig) === '1' ? 'committed' : 'review')
    } catch {
      // ignore storage errors
    }
  }, [sig])

  if (!diagram) return <pre>{jsonString}</pre>

  const handleApply = async () => {
    if (busy || phase === 'committed') return
    setBusy(true)
    const context = activeWorkspace || 'default'

    try {
      const outcome = await withLock(`wall-diagram:${context}`, async () => {
        let index = await loadWallIndex(context)
        let targetWall = index.walls.find(w => w.id === index.activeId) ?? index.walls[0]

        if (diagram.wallName) {
          const existing = index.walls.find(w => w.name.toLowerCase() === diagram.wallName?.toLowerCase())
          if (existing) {
            targetWall = existing
            index = setActiveWall(index, existing.id)
          } else {
            const created = createWall(index, diagram.wallName)
            index = created.index
            targetWall = created.wall
          }
          await saveWallIndex(context, index)
        }

        const key = wallDocKey(context, targetWall.id)
        const doc = await loadWallDoc(key)
        let items: WallItem[] = [...doc.items]
        const idMap = new Map<string, string>()

        // place frames first so subsequent shapes/notes paint cleanly above them
        const orderedSpecs = [...diagram.items].sort((a, b) => (a.kind === 'frame' ? -1 : b.kind === 'frame' ? 1 : 0))
        let placedCount = 0

        for (const spec of orderedSpecs) {
          const created = createWallItem(spec.kind, { x: spec.x, y: spec.y }, items, {
            ...(spec.text ? { text: spec.text } : {}),
            ...(spec.width ? { width: spec.width } : {}),
            ...(spec.height ? { height: spec.height } : {}),
            ...(spec.color ? { color: spec.color } : {}),
            ...(spec.kind === 'shape' && spec.shape && spec.shape !== 'rectangle' ? { shape: spec.shape } : {})
          })

          if (spec.language && spec.kind === 'code') {
            const edited = editWallItem([...items, created], created.id, { language: spec.language })
            if (!('error' in edited)) {
              items = edited.items
              idMap.set(spec.id, edited.item.id)
              placedCount++
              continue
            }
          }

          items = [...items, created]
          idMap.set(spec.id, created.id)
          placedCount++
        }

        let arrowCount = 0
        for (const conn of diagram.connections) {
          const fromId = idMap.get(conn.from)
          const toId = idMap.get(conn.to)
          if (!fromId || !toId) continue
          const res = connectWallItems(items, fromId, toId, {
            label: conn.label,
            route: conn.route,
            line: conn.line,
            heads: conn.heads,
            color: conn.color
          })
          if (!('error' in res)) {
            items = res.items
            arrowCount++
          }
        }

        await flushWallDoc(key, { ...doc, items }, { context, wallId: targetWall.id })
        return { wallName: targetWall.name, placedCount, arrowCount }
      })

      setPhase('committed')
      setPlacedSummary(`Placed ${outcome.placedCount} items and ${outcome.arrowCount} arrows on "${outcome.wallName}".`)
      try {
        if (sig) localStorage.setItem(sig, '1')
      } catch {
        // ignore
      }
      toast(`Added diagram to wall "${outcome.wallName}"!`, { type: 'success' })
    } catch (err) {
      report('place wall diagram', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(14, 24, 38, 0.96), rgba(10, 14, 24, 0.99))',
      border: '1px solid rgba(56, 189, 248, 0.35)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 14px',
      margin: '10px 0'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', fontWeight: 700, color: '#38bdf8' }}>
          <Sparkles size={14} />
          <span>Wall Diagram{diagram.wallName ? `: ${diagram.wallName}` : ''}</span>
        </div>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          {diagram.items.length} item{diagram.items.length === 1 ? '' : 's'}
          {diagram.connections.length > 0 ? ` · ${diagram.connections.length} connection${diagram.connections.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
        {diagram.items.slice(0, 8).map(item => (
          <span
            key={item.id}
            style={{
              fontSize: 'var(--text-xs)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--color-text-base)'
            }}
          >
            {item.kind}: {item.text.slice(0, 32)}{item.text.length > 32 ? '…' : ''}
          </span>
        ))}
        {diagram.items.length > 8 && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            +{diagram.items.length - 8} more
          </span>
        )}
      </div>

      {placedSummary && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', color: '#4ade80', marginBottom: '8px' }}>
          <CheckCircle2 size={13} />
          <span>{placedSummary}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {phase === 'review' ? (
          <button type="button" className="btn-primary btn-small" onClick={handleApply} disabled={busy}>
            <Check size={12} />
            {busy ? 'Placing...' : 'Add to Wall'}
          </button>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', color: '#4ade80', fontWeight: 600 }}>
            <CheckCircle2 size={13} />
            Added to Wall
          </span>
        )}
        <button type="button" className="btn-secondary btn-small" onClick={() => setView('wall')}>
          Open Wall
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  )
}
