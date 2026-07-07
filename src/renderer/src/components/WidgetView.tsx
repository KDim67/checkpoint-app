import React, { useState, useEffect, useRef } from 'react'
import Logo from './ui/Logo'

interface WidgetData {
  totalCount: number
  doneCount: number
  inProgressCount: number
  openCount: number
  recentLog: string | null
  time: string
}

function formatTime(): string {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })
}

async function fetchWidgetData(context: string): Promise<WidgetData> {
  try {
    const [taskRes, cardRes] = await Promise.all([
      window.electronAPI.db.getItems(context, 'task', 1, 500),
      window.electronAPI.db.getItems(context, 'card', 1, 500)
    ])

    const allItems = [...taskRes.items, ...cardRes.items]
    const activeItems = allItems.filter(i => i.status !== 'archived')

    const doneCount = activeItems.filter(i => i.status === 'done').length
    const inProgressCount = activeItems.filter(i => i.status === 'in_progress').length
    const openCount = activeItems.filter(i => i.status === 'open' || i.status === 'todo').length
    const totalCount = activeItems.length

    // Fetch the most recent log entry
    const logRes = await window.electronAPI.db.getItems(context, 'log', 1, 1)
    const rawLog = logRes.items[0]?.title ?? null
    const recentLog = rawLog
      ? rawLog.length > 38
        ? rawLog.substring(0, 35) + '…'
        : rawLog
      : null

    return {
      totalCount,
      doneCount,
      inProgressCount,
      openCount,
      recentLog,
      time: formatTime()
    }
  } catch (err) {
    console.error('Failed to fetch widget data:', err)
    return {
      totalCount: 0,
      doneCount: 0,
      inProgressCount: 0,
      openCount: 0,
      recentLog: null,
      time: formatTime()
    }
  }
}

export default function WidgetView() {
  const [data, setData] = useState<WidgetData>({
    totalCount: 0,
    doneCount: 0,
    inProgressCount: 0,
    openCount: 0,
    recentLog: null,
    time: formatTime()
  })
  
  const [hovered, setHovered] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const contextRef = useRef<string>('default')

  const refresh = async () => {
    const d = await fetchWidgetData(contextRef.current)
    setData(d)
  }

  useEffect(() => {
    // Load context, then poll every 5 seconds for live responsiveness
    window.electronAPI.db.getSetting('active_context').then((ctx) => {
      if (typeof ctx === 'string' && ctx) {
        contextRef.current = ctx
      }
      refresh()
    }).catch(() => refresh())

    intervalRef.current = setInterval(refresh, 5000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const percentage = data.totalCount > 0 ? Math.round((data.doneCount / data.totalCount) * 100) : 0
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '280px',
        height: '160px',
        padding: '12px 14px',
        background: 'rgba(10, 12, 18, 0.85)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: '16px',
        border: hovered 
          ? '1px solid rgba(205, 241, 43, 0.35)' 
          : '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: hovered
          ? '0 12px 32px rgba(0, 0, 0, 0.6), 0 0 15px rgba(205, 241, 43, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
          : '0 8px 24px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        fontFamily: 'var(--font-sans)',
        userSelect: 'none',
        overflow: 'hidden',
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      {/* Top: Header spans full width to prevent time/logo overlap */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexShrink: 0 }}>
        <Logo size={14} showText />
        <span style={{
          fontSize: '12px',
          fontWeight: 700,
          color: 'var(--color-text-base)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap'
        }}>
          {data.time}
        </span>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.06)', width: '100%', flexShrink: 0 }} />

      {/* Bottom Area: Split columns */}
      <div style={{ display: 'flex', flex: 1, gap: '12px', minHeight: 0 }}>
        {/* Left Column: Task Progress Circle */}
        <div style={{
          width: '74px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          borderRight: '1px solid rgba(255, 255, 255, 0.06)',
          paddingRight: '10px',
          flexShrink: 0
        }}>
          <div style={{ position: 'relative', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx="24"
                cy="24"
                r={radius}
                fill="transparent"
                stroke="rgba(255, 255, 255, 0.04)"
                strokeWidth="3.5"
              />
              <circle
                cx="24"
                cy="24"
                r={radius}
                fill="transparent"
                stroke="var(--color-primary)"
                strokeWidth="3.5"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 400ms cubic-bezier(0.4, 0, 0.2, 1)' }}
              />
            </svg>
            <div style={{
              position: 'absolute',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10.5px',
              fontWeight: 700,
              color: 'var(--color-text-base)',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {percentage}%
            </div>
          </div>
          <div style={{
            fontSize: '8px',
            fontWeight: 700,
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            textAlign: 'center',
            lineHeight: 1.2
          }}>
            {data.doneCount}/{data.totalCount}<br/>Done
          </div>
        </div>

        {/* Right Column: Time, Metrics & Logs */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minWidth: 0,
          paddingTop: '2px',
          paddingBottom: '2px'
        }}>
          {/* Middle: Micro Indicators */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 6px #3b82f6aa' }} />
              <span style={{ fontSize: '10.5px', color: 'var(--color-text-muted)' }}>
                <strong>{data.inProgressCount}</strong> Active
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 6px #f59e0baa' }} />
              <span style={{ fontSize: '10.5px', color: 'var(--color-text-muted)' }}>
                <strong>{data.openCount}</strong> To Do
              </span>
            </div>
          </div>

          {/* Bottom: Activity Log */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: '8px',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1px',
            minWidth: 0
          }}>
            <span style={{
              fontSize: '8px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-primary)'
            }}>
              Latest Activity Log
            </span>
            <span style={{
              fontSize: '10.5px',
              color: data.recentLog ? 'var(--color-text-base)' : 'var(--color-text-faint)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
              lineHeight: 1.3
            }}>
              {data.recentLog ? `↳ ${data.recentLog}` : 'No recent entries'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
