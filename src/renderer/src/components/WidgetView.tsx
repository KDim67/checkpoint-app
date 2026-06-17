import React, { useState, useEffect, useRef } from 'react'

interface WidgetData {
  todayTaskCount: number
  inProgressCount: number
  recentLog: string | null
  time: string
}

function formatTime(): string {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

async function fetchWidgetData(): Promise<WidgetData> {
  const now = Date.now()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  try {
    // Tasks due today or active
    const taskRes = await window.electronAPI.db.getItems('default', 'task', 1, 200)
    const todayTasks = taskRes.items.filter(
      i => i.status !== 'archived' && i.status !== 'done'
    )

    // In-progress kanban cards
    const cardRes = await window.electronAPI.db.getItems('default', 'card', 1, 200)
    const inProgress = cardRes.items.filter(i => i.status === 'in_progress')

    // Most recent log entry
    const logRes = await window.electronAPI.db.getItems('default', 'log', 1, 1)
    const rawLog = logRes.items[0]?.title ?? null
    const recentLog = rawLog
      ? rawLog.length > 60
        ? rawLog.substring(0, 57) + '…'
        : rawLog
      : null

    void now  // suppress unused var
    return {
      todayTaskCount: todayTasks.length,
      inProgressCount: inProgress.length,
      recentLog,
      time: formatTime()
    }
  } catch {
    return {
      todayTaskCount: 0,
      inProgressCount: 0,
      recentLog: null,
      time: formatTime()
    }
  }
}

export default function WidgetView() {
  const [data, setData] = useState<WidgetData>({
    todayTaskCount: 0,
    inProgressCount: 0,
    recentLog: null,
    time: formatTime()
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = async () => {
    const d = await fetchWidgetData()
    setData(d)
  }

  useEffect(() => {
    refresh()
    intervalRef.current = setInterval(() => {
      refresh()
    }, 60_000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Transparent widget shell, no scroll, no interactive elements
  return (
    <div style={{
      width: '280px',
      height: '160px',
      padding: '14px 16px',
      background: 'rgba(11, 12, 16, 0.82)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderRadius: '14px',
      border: '1px solid rgba(255,255,255,0.08)',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      fontFamily: "'Inter', sans-serif",
      userSelect: 'none',
      overflow: 'hidden'
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '2px',
            background: '#1e45fc'
          }} />
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase'
          }}>
            Checkpoint
          </span>
        </div>
        <span style={{
          fontSize: '13px',
          fontWeight: 600,
          color: 'rgba(255,255,255,0.7)',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {data.time}
        </span>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <StatPill
          value={data.todayTaskCount}
          label="Open Tasks"
          color="#cdf12b"
        />
        <StatPill
          value={data.inProgressCount}
          label="In Progress"
          color="#3b82f6"
        />
      </div>

      {/* Recent log */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'flex-end'
      }}>
        {data.recentLog ? (
          <span style={{
            fontSize: '11px',
            color: 'rgba(255,255,255,0.35)',
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            width: '100%'
          }}>
            ↳ {data.recentLog}
          </span>
        ) : (
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>
            No recent activity
          </span>
        )}
      </div>
    </div>
  )
}

function StatPill({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{
      flex: 1,
      background: `${color}12`,
      border: `1px solid ${color}25`,
      borderRadius: '8px',
      padding: '6px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }}>
      <span style={{
        fontSize: '18px',
        fontWeight: 700,
        color,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums'
      }}>
        {value}
      </span>
      <span style={{
        fontSize: '9px',
        color: 'rgba(255,255,255,0.35)',
        fontWeight: 500,
        letterSpacing: '0.04em',
        textTransform: 'uppercase'
      }}>
        {label}
      </span>
    </div>
  )
}
