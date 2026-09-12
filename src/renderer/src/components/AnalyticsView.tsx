import React, { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import type { AnalyticsData } from '../../../shared/types'
import * as analyticsApi from '../data/analytics'
import * as trackerApi from '../data/tracker'

const ALLOCATION_COLORS = ['#10b981', '#1e45fc', '#f97316', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#cdf12b']

// SVG Icons

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number }

function IconFocus({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconChart({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  )
}

function IconTag({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  )
}

function IconClock({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 15 15" />
    </svg>
  )
}

function IconHourglass({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 2h14" />
      <path d="M5 22h14" />
      <path d="M19 2v4c0 3.3-2.7 6-6 6H11C7.7 12 5 9.3 5 6V2" />
      <path d="M5 22v-4c0-3.3 2.7-6 6-6h2c3.3 0 6 2.7 6 6v4" />
    </svg>
  )
}

function IconRefresh({ size = 12, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  )
}

// Helpers

const formatDuration = (ms: number) => {
  if (ms <= 0) return '0s'
  const secs = ms / 1000
  const mins = secs / 60
  const hrs = mins / 60
  const days = hrs / 24

  if (days >= 1) return `${days.toFixed(1)}d`
  if (hrs >= 1) return `${hrs.toFixed(1)}h`
  if (mins >= 1) return `${mins.toFixed(1)}m`
  return `${secs.toFixed(0)}s`
}

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Turn a raw column status id into a readable label. Handles the default columns
// and the custom "col-<slug>-<timestamp>" ids the board generates.
const DEFAULT_COLUMN_LABELS: Record<string, string> = {
  open: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done'
}
const formatColumnLabel = (status: string): string => {
  if (DEFAULT_COLUMN_LABELS[status]) return DEFAULT_COLUMN_LABELS[status]
  const custom = status.match(/^col-(.+)-\d+$/)
  if (custom) return custom[1].replace(/-/g, ' ')
  return status.replace(/[_-]/g, ' ')
}

// Main Component

export default function AnalyticsView() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Sub-tabs for Focus Sessions vs Activity Timeline
  const [activeTab, setActiveTab] = useState<'focus' | 'timeline'>('focus')
  const [timelineRange, setTimelineRange] = useState<'today' | 'yesterday' | 'week'>('today')
  const [timelineData, setTimelineData] = useState<{
    totalDurationMs: number
    byProcess: Array<{ processName: string; durationMs: number }>
    byContext: Array<{ context: string; durationMs: number }>
    byTitle: Array<{ windowTitle: string; processName: string; durationMs: number }>
  } | null>(null)
  const [timelineLoading, setTimelineLoading] = useState(false)

  // Hover states for tooltips
  const [hoveredHeatmapCell, setHoveredHeatmapCell] = useState<{
    dateStr: string
    count: number
    x: number
    y: number
  } | null>(null)

  const [hoveredLinePoint, setHoveredLinePoint] = useState<{
    week: string
    count: number
    x: number
    y: number
  } | null>(null)

  const [hoveredBar, setHoveredBar] = useState<{
    column: string
    avgMs: number
    x: number
    y: number
  } | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      // Scope to the active workspace (null = all) so the dashboard matches its header.
      const res = await analyticsApi.getAnalytics(activeWorkspace === 'all' ? null : activeWorkspace)
      setData(res)
      setError(null)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to load analytics dashboard'
      setError(errMsg)
    } finally {
      setLoading(false)
    }
  }, [activeWorkspace])

  const formatMsToHoursAndMins = (ms: number) => {
    const totalMins = Math.floor(ms / (1000 * 60))
    const hrs = Math.floor(totalMins / 60)
    const mins = totalMins % 60
    if (hrs > 0) {
      return `${hrs}h ${mins}m`
    }
    return `${mins}m`
  }

  const fetchTimelineData = useCallback(async () => {
    setTimelineLoading(true)
    try {
      const now = Date.now()
      let start = now
      let end = now

      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      if (timelineRange === 'today') {
        start = todayStart.getTime()
        end = now
      } else if (timelineRange === 'yesterday') {
        const yest = new Date()
        yest.setDate(yest.getDate() - 1)
        yest.setHours(0, 0, 0, 0)
        start = yest.getTime()
        const yestEnd = new Date()
        yestEnd.setDate(yestEnd.getDate() - 1)
        yestEnd.setHours(23, 59, 59, 999)
        end = yestEnd.getTime()
      } else if (timelineRange === 'week') {
        const weekAgo = new Date()
        weekAgo.setDate(weekAgo.getDate() - 7)
        weekAgo.setHours(0, 0, 0, 0)
        start = weekAgo.getTime()
        end = now
      }

      const res = await trackerApi.getActivityStats(
        activeWorkspace === 'all' ? null : activeWorkspace,
        start,
        end
      )
      // Normalize so the render never crashes on a missing array.
      setTimelineData({
        totalDurationMs: res?.totalDurationMs || 0,
        byProcess: res?.byProcess || [],
        byContext: res?.byContext || [],
        byTitle: res?.byTitle || []
      })
    } catch (err) {
      console.error('Error fetching activity stats:', err)
    } finally {
      setTimelineLoading(false)
    }
  }, [timelineRange, activeWorkspace])

  useEffect(() => {
    fetchData()
  }, [activeWorkspace, fetchData])

  useEffect(() => {
    if (activeTab === 'timeline') {
      fetchTimelineData()
    }
  }, [activeTab, fetchTimelineData])

  if (loading) {
    return (
      <div style={{
        padding: 'var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
        overflowY: 'auto',
        height: '100%',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-text-base)',
        fontFamily: 'var(--font-sans)',
        boxSizing: 'border-box'
      }}>
        {/* Header */}
        <div>
          <div className="skeleton" style={{ height: '24px', width: '160px', marginBottom: '8px' }} />
          <div className="skeleton" style={{ height: '14px', width: '280px', opacity: 0.6 }} />
        </div>

        {/* KPI Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 'var(--space-4)' }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="analytics-card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
              <div className="skeleton" style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)', flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div className="skeleton" style={{ width: '50px', height: '22px' }} />
                <div className="skeleton" style={{ width: '110px', height: '12px', opacity: 0.6 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Activity Heatmap Calendar */}
        <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
          <div className="row-between">
            <div className="skeleton" style={{ width: '150px', height: '16px' }} />
            <div className="skeleton" style={{ width: '80px', height: '14px', opacity: 0.6 }} />
          </div>

          <div style={{ overflowX: 'auto', paddingBottom: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {/* Month Headers Mock */}
            <div style={{ display: 'flex', gap: '12px', marginLeft: '26px', height: '14px' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                <div key={m} className="skeleton" style={{ width: '22px', height: '9px', opacity: 0.5 }} />
              ))}
            </div>

            <div style={{ display: 'flex', gap: '4px' }}>
              {/* Day of Week Indicators */}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '82px', fontSize: '9px', color: 'var(--color-text-faint)', width: '22px', textAlign: 'right', paddingRight: '4px', paddingTop: '2px' }}>
                <span>Sun</span>
                <span>Tue</span>
                <span>Thu</span>
                <span>Sat</span>
              </div>

              {/* Mock Heatmap Grid */}
              <div style={{ display: 'flex', gap: '2px', flex: 1 }}>
                {Array.from({ length: 53 }).map((_, colIdx) => (
                  <div key={colIdx} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {Array.from({ length: 7 }).map((_, rowIdx) => (
                      <div
                        key={rowIdx}
                        className="skeleton"
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '2px',
                          opacity: 0.12 + ((colIdx + rowIdx) % 5 === 0 ? 0.3 : 0.05)
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Two-Column Mid Section */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(400px, 100%), 1fr))', gap: 'var(--space-4)' }}>
          {/* Line Chart Card */}
          <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
            <div className="row">
              <div className="skeleton" style={{ width: '16px', height: '16px', borderRadius: '50%' }} />
              <div className="skeleton" style={{ width: '130px', height: '16px' }} />
            </div>
            <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
                <path
                  d="M 40 130 Q 120 40 200 110 T 360 50"
                  fill="none"
                  stroke="var(--color-surface-offset)"
                  strokeWidth="3"
                  strokeDasharray="5,5"
                  className="skeleton"
                  style={{ animationDuration: '3s' }}
                />
                <circle cx="40" cy="130" r="4" fill="var(--color-surface-offset)" />
                <circle cx="120" cy="50" r="4" fill="var(--color-surface-offset)" />
                <circle cx="200" cy="110" r="4" fill="var(--color-surface-offset)" />
                <circle cx="280" cy="80" r="4" fill="var(--color-surface-offset)" />
                <circle cx="360" cy="50" r="4" fill="var(--color-surface-offset)" />
              </svg>
            </div>
          </div>

          {/* Bar Chart Card */}
          <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
            <div className="row">
              <div className="skeleton" style={{ width: '16px', height: '16px', borderRadius: '50%' }} />
              <div className="skeleton" style={{ width: '150px', height: '16px' }} />
            </div>
            <div style={{ height: '160px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', padding: '0 var(--space-4)' }}>
              {[60, 110, 80, 130].map((h, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', width: '36px' }}>
                  <div className="skeleton" style={{ width: '100%', height: `${h}px`, borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0' }} />
                  <div className="skeleton" style={{ width: '24px', height: '10px' }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(400px, 100%), 1fr))', gap: 'var(--space-4)' }}>
          {/* Tag Distribution */}
          <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
            <div className="skeleton" style={{ width: '110px', height: '16px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div className="skeleton" style={{ width: '60px', height: '14px' }} />
                    <div className="skeleton" style={{ width: '30px', height: '14px' }} />
                  </div>
                  <div className="skeleton" style={{ width: '100%', height: '8px', borderRadius: '4px' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Recent Sessions */}
          <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
            <div className="skeleton" style={{ width: '150px', height: '16px' }} />
            <div className="col">
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-surface-offset)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div className="skeleton" style={{ width: '100px', height: '14px' }} />
                    <div className="skeleton" style={{ width: '130px', height: '10px' }} />
                  </div>
                  <div className="skeleton" style={{ width: '50px', height: '14px' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ padding: 'var(--space-6)', color: 'var(--color-error)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <h3>Failed to load analytics data</h3>
        <p style={{ color: 'var(--color-text-muted)' }}>{error || 'No database connections available'}</p>
      </div>
    )
  }

  // Heatmap Calendar Computations
  const today = new Date()
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const daysList: Array<{ dateStr: string; date: Date; count: number; isPlaceholder?: boolean }> = []

  // Go back 364 days (exact 52 weeks ago + alignment offset)
  const startDay = new Date(localToday.getTime() - 364 * 24 * 60 * 60 * 1000)
  const startDayOfWeek = startDay.getDay() // 0 = Sunday

  // Pad the beginning so the calendar grid consistently aligns with Sunday as the top row
  for (let i = 0; i < startDayOfWeek; i++) {
    daysList.push({ dateStr: '', date: new Date(), count: 0, isPlaceholder: true })
  }

  const heatmapMap = new Map<string, number>()
  data.logHeatmap.forEach(row => {
    heatmapMap.set(row.date, row.count)
  })

  for (let i = 364; i >= 0; i--) {
    const d = new Date(localToday.getTime() - i * 24 * 60 * 60 * 1000)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dayStr = String(d.getDate()).padStart(2, '0')
    const dateStr = `${y}-${m}-${dayStr}`

    daysList.push({
      dateStr,
      date: d,
      count: heatmapMap.get(dateStr) || 0
    })
  }

  // Group into columns (7 days per column)
  const columns: typeof daysList[] = []
  for (let i = 0; i < daysList.length; i += 7) {
    columns.push(daysList.slice(i, i + 7))
  }

  // Get month name headers
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthHeaders: { text: string; colIndex: number }[] = []
  let lastMonthIndex = -1
  columns.forEach((col, colIdx) => {
    const firstValidDay = col.find(d => !d.isPlaceholder)
    if (firstValidDay) {
      const m = firstValidDay.date.getMonth()
      if (m !== lastMonthIndex) {
        // Prevent labeling very close columns to avoid clutter
        if (monthHeaders.length === 0 || colIdx - monthHeaders[monthHeaders.length - 1].colIndex > 2) {
          monthHeaders.push({ text: monthNames[m], colIndex: colIdx })
          lastMonthIndex = m
        }
      }
    }
  })

  // Heatmap opacity colors
  const getCellStyles = (count: number) => {
    if (count === 0) return { backgroundColor: 'var(--color-surface-2)', opacity: 0.5 }
    if (count <= 1) return { backgroundColor: 'var(--color-secondary)', opacity: 0.3 }
    if (count <= 3) return { backgroundColor: 'var(--color-secondary)', opacity: 0.55 }
    if (count <= 6) return { backgroundColor: 'var(--color-secondary)', opacity: 0.8 }
    return { backgroundColor: 'var(--color-secondary)', opacity: 1, boxShadow: '0 0 8px var(--color-secondary)' }
  }

  // Line Graph Computations
  const weeklyWidth = 460
  const weeklyHeight = 160
  const linePadding = { top: 20, right: 20, bottom: 30, left: 40 }
  const lineChartW = weeklyWidth - linePadding.left - linePadding.right
  const lineChartH = weeklyHeight - linePadding.top - linePadding.bottom

  const maxWeeklyCount = Math.max(data.tasksCompletedWeekly.reduce((a, d) => Math.max(a, d.count), 0), 5)
  const linePoints = data.tasksCompletedWeekly.map((d, i) => {
    const x = linePadding.left + (i / Math.max(1, data.tasksCompletedWeekly.length - 1)) * lineChartW
    const y = linePadding.top + lineChartH - (d.count / maxWeeklyCount) * lineChartH
    return { x, y, week: d.week, count: d.count }
  })

  const pathD = linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaD = linePoints.length > 0
    ? `${pathD} L ${linePoints[linePoints.length - 1].x} ${linePadding.top + lineChartH} L ${linePoints[0].x} ${linePadding.top + lineChartH} Z`
    : ''

  // Bar Chart Computations
  const barWidth = 460
  const barHeight = 160
  const barPadding = { top: 20, right: 20, bottom: 30, left: 45 }
  const barChartW = barWidth - barPadding.left - barPadding.right
  const barChartH = barHeight - barPadding.top - barPadding.bottom

  const maxBarMs = Math.max(data.columnTime.reduce((a, d) => Math.max(a, d.avgMs), 0), 1)
  const renderBarW = Math.min(36, barChartW / Math.max(1, data.columnTime.length) - 16)

  // Tag Distribution
  const totalTagUses = data.mostUsedTags.reduce((acc, t) => acc + t.count, 0)

  // Timeline View Renderer
  const renderTimelineView = () => {
    if (timelineLoading && !timelineData) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-2) 0' }}>
          <div className="skeleton" style={{ height: '36px', width: '200px' }} />
          <div className="skeleton" style={{ height: '120px', borderRadius: 'var(--radius-lg)' }} />
          <div className="skeleton" style={{ height: '240px', borderRadius: 'var(--radius-lg)' }} />
        </div>
      )
    }

    const totalHoursStr = timelineData ? formatMsToHoursAndMins(timelineData.totalDurationMs) : '0m'

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Date Selector Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {(['today', 'yesterday', 'week'] as const).map(range => (
              <button
                key={range}
                onClick={() => setTimelineRange(range)}
                style={{
                  background: timelineRange === range ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                  border: '1px solid ' + (timelineRange === range ? 'var(--color-secondary)' : 'var(--color-surface-offset)'),
                  color: timelineRange === range ? 'var(--color-secondary)' : 'var(--color-text-base)',
                  padding: 'var(--space-2) var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-medium)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  transition: 'all 120ms ease'
                }}
              >
                {range === 'week' ? 'Last 7 Days' : range}
              </button>
            ))}
          </div>

          <button
            onClick={fetchTimelineData}
            disabled={timelineLoading}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              opacity: timelineLoading ? 0.6 : 1
            }}
          >
            <IconRefresh size={15} />
            <span>Refresh</span>
          </button>
        </div>

        {timelineLoading ? (
          <div style={{ padding: 'var(--space-8)', display: 'flex', justifyContent: 'center' }}>
            <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
              Querying active timeline logs...
            </div>
          </div>
        ) : !timelineData || timelineData.totalDurationMs === 0 ? (
          <div style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-8)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginTop: 'var(--space-2)'
          }}>
            <IconClock size={32} style={{ color: 'var(--color-text-faint)' }} />
            <h4 style={{ margin: 0, fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>No Activity Tracked</h4>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', maxWidth: '320px', lineHeight: 1.5 }}>
              We couldn't find any window focus logs for this context and range. Ensure the **Passive Activity Tracker** is enabled in Settings under Features.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
            {/* Left Column: Summary & Process Share */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {/* Total Hours Card */}
              <div className="analytics-card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-secondary-muted)', color: 'var(--color-secondary)' }}>
                  <IconHourglass size={24} />
                </div>
                <div>
                  <div className="kpi-value">{totalHoursStr}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>Total Tracked Development Time</div>
                </div>
              </div>

              {/* Process Share Card */}
              <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>Process Share</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {timelineData.byProcess.map((proc, idx) => {
                    const percentage = timelineData.totalDurationMs > 0 ? (proc.durationMs / timelineData.totalDurationMs) * 100 : 0
                    const barColor = ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length]
                    return (
                      <div key={proc.processName} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                          <span style={{ fontWeight: 'var(--weight-medium)', textTransform: 'capitalize' }}>{proc.processName}</span>
                          <span style={{ color: 'var(--color-text-muted)' }}>{formatMsToHoursAndMins(proc.durationMs)} ({percentage.toFixed(0)}%)</span>
                        </div>
                        <div style={{ height: '6px', background: 'var(--color-surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${percentage}%`, background: barColor, borderRadius: '3px', transition: 'width 300ms ease' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: Active Window Titles */}
            <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>Top Active Windows</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2.5)', overflowY: 'auto', maxHeight: '320px', paddingRight: '2px' }}>
                {timelineData.byTitle.map((title, idx) => {
                  const percentage = timelineData.totalDurationMs > 0 ? (title.durationMs / timelineData.totalDurationMs) * 100 : 0
                  return (
                    <div key={idx} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 'var(--space-2)',
                      background: 'var(--color-surface-2)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--text-xs)',
                      gap: 'var(--space-3)'
                    }}>
                      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={title.windowTitle}>
                          {title.windowTitle || 'Untitled Window'}
                        </span>
                        <span style={{ color: 'var(--color-text-faint)', fontSize: '10px', textTransform: 'uppercase' }}>
                          {title.processName}
                        </span>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ color: 'var(--color-secondary)', fontWeight: 'var(--weight-semibold)' }}>
                          {formatMsToHoursAndMins(title.durationMs)}
                        </div>
                        <div style={{ color: 'var(--color-text-faint)', fontSize: '9px' }}>
                          {percentage.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{
      padding: 'var(--space-6)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      overflowY: 'auto',
      height: '100%',
      boxSizing: 'border-box',
      backgroundColor: 'var(--color-background)',
      color: 'var(--color-text-base)',
      fontFamily: 'var(--font-sans)'
    }}>
      <style>{`
        /* Smooth micro-animations */
        .analytics-card {
          background: var(--color-surface-1);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          transition: border-color var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default);
        }
        .analytics-card:hover {
          border-color: var(--color-balance);
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        }
        .kpi-value {
          font-size: var(--text-2xl);
          font-weight: var(--weight-bold);
          line-height: 1.2;
          background: linear-gradient(135deg, var(--color-text-base) 60%, var(--color-secondary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .heatmap-cell {
          width: 10px;
          height: 10px;
          border-radius: 2px;
          cursor: pointer;
          transition: transform 100ms ease, filter 100ms ease;
        }
        .heatmap-cell:hover {
          transform: scale(1.3);
          filter: brightness(1.2);
          z-index: 10;
        }
        .hover-line-point {
          transition: r var(--duration-fast) var(--ease-default);
        }
        .hover-line-point:hover {
          r: 7px;
        }
      `}</style>

      <div className="analytics-inner" style={{ width: '100%', maxWidth: '1400px', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', margin: '0 0 var(--space-1)' }}>
            Analytics
          </h2>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
            {activeWorkspace === 'all'
              ? <>Insights across <strong style={{ color: 'var(--color-secondary)' }}>all workspaces</strong></>
              : <>Insights for workspace <strong style={{ color: 'var(--color-secondary)' }}>{activeWorkspace}</strong></>}
          </p>
        </div>
        <button
          onClick={fetchData}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-medium)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 120ms ease'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-surface-offset)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--color-surface-2)'
          }}
        >
          <IconRefresh size={15} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Tab Switcher */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-1)',
        background: 'var(--color-surface-2)',
        padding: '3px',
        borderRadius: 'var(--radius-md)',
        width: 'fit-content',
        border: '1px solid var(--color-surface-offset)',
        marginBottom: 'var(--space-1)'
      }}>
        <button
          onClick={() => setActiveTab('focus')}
          style={{
            background: activeTab === 'focus' ? 'var(--color-surface-elevated)' : 'transparent',
            border: 'none',
            color: activeTab === 'focus' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
            fontWeight: activeTab === 'focus' ? 'var(--weight-semibold)' : 'var(--weight-normal)',
            padding: 'var(--space-2) var(--space-5)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
            transition: 'all 150ms ease',
            boxShadow: activeTab === 'focus' ? 'var(--shadow-sm)' : 'none'
          }}
        >
          Focus Sessions
        </button>
        <button
          onClick={() => setActiveTab('timeline')}
          style={{
            background: activeTab === 'timeline' ? 'var(--color-surface-elevated)' : 'transparent',
            border: 'none',
            color: activeTab === 'timeline' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
            fontWeight: activeTab === 'timeline' ? 'var(--weight-semibold)' : 'var(--weight-normal)',
            padding: 'var(--space-2) var(--space-5)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
            transition: 'all 150ms ease',
            boxShadow: activeTab === 'timeline' ? 'var(--shadow-sm)' : 'none'
          }}
        >
          Activity Timeline
        </button>
      </div>

      {activeTab === 'focus' ? (
        <>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 'var(--space-4)' }}>
        <div className="analytics-card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div style={{ padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', background: 'var(--color-secondary-muted)', color: 'var(--color-secondary)' }}>
            <IconFocus />
          </div>
          <div>
            <div className="kpi-value">{data.focusStats.totalSessions}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>Total Focus Sessions</div>
          </div>
        </div>

        <div className="analytics-card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div style={{ padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', background: 'rgba(30, 69, 252, 0.15)', color: 'var(--color-primary)' }}>
            <IconClock />
          </div>
          <div>
            <div className="kpi-value">
              {Math.floor(data.focusStats.totalDurationMins / 60) > 0 ? (
                <>
                  {Math.floor(data.focusStats.totalDurationMins / 60)}{' '}
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginRight: '4px' }}>h</span>
                  {data.focusStats.totalDurationMins % 60}{' '}
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>m</span>
                </>
              ) : (
                <>
                  {data.focusStats.totalDurationMins}{' '}
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>m</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>Total Focus Time</div>
          </div>
        </div>

        <div className="analytics-card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div style={{ padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', background: 'var(--color-secondary-muted)', color: 'var(--color-secondary)' }}>
            <IconHourglass />
          </div>
          <div>
            <div className="kpi-value">{data.focusStats.avgSessionMins} <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>mins</span></div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>Avg Focus Session</div>
          </div>
        </div>
      </div>

      {/* Heatmap Calendar Card */}
      <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Log Activity Timeline</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Past 365 Days</span>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '0 1 auto' }}>
        <div style={{ overflowX: 'auto', paddingBottom: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {/* Month Headers */}
          <div style={{ display: 'flex', position: 'relative', height: '14px', marginLeft: '26px' }}>
            {monthHeaders.map((header, i) => (
              <span
                key={i}
                style={{
                  position: 'absolute',
                  left: `${header.colIndex * 12}px`,
                  fontSize: '9px',
                  color: 'var(--color-text-muted)',
                  whiteSpace: 'nowrap'
                }}
              >
                {header.text}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '4px' }}>
            {/* Day of Week Indicators */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '82px', fontSize: '9px', color: 'var(--color-text-faint)', width: '22px', textAlign: 'right', paddingRight: '4px', paddingTop: '2px' }}>
              <span>Sun</span>
              <span>Tue</span>
              <span>Thu</span>
              <span>Sat</span>
            </div>

            {/* Heatmap Grid */}
            <div style={{ display: 'flex', gap: '2px' }}>
              {columns.map((column, colIdx) => (
                <div key={colIdx} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {column.map((day, rowIdx) => {
                    if (day.isPlaceholder) {
                      return <div key={rowIdx} style={{ width: '10px', height: '10px' }} />
                    }
                    return (
                      <div
                        key={rowIdx}
                        className="heatmap-cell"
                        style={getCellStyles(day.count)}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          const parentRect = e.currentTarget.closest('.analytics-card')?.getBoundingClientRect()
                          setHoveredHeatmapCell({
                            dateStr: day.dateStr,
                            count: day.count,
                            x: rect.left - (parentRect?.left || 0) + 5,
                            y: rect.top - (parentRect?.top || 0) - 38
                          })
                        }}
                        onMouseLeave={() => setHoveredHeatmapCell(null)}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Heatmap Legend */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--space-1-5)', fontSize: '10px', color: 'var(--color-text-muted)' }}>
          <span>Less</span>
          <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'var(--color-surface-2)' }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'var(--color-secondary)', opacity: 0.3 }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'var(--color-secondary)', opacity: 0.55 }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'var(--color-secondary)', opacity: 0.8 }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'var(--color-secondary)', opacity: 1 }} />
          <span>More</span>
        </div>
        </div>

        <div style={{ flex: '1 1 200px', minWidth: '170px', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderLeft: '1px solid var(--color-surface-offset)', paddingLeft: 'var(--space-5)' }}>
          {(() => {
            const total = data.logHeatmap.reduce((a, d) => a + d.count, 0)
            const activeDays = data.logHeatmap.filter(d => d.count > 0).length
            const busiest = data.logHeatmap.reduce((a, d) => Math.max(a, d.count), 0)
            const stats = [
              { label: 'Total logs', value: total },
              { label: 'Active days', value: activeDays },
              { label: 'Busiest day', value: busiest }
            ]
            return stats.map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
              </div>
            ))
          })()}
        </div>
        </div>

        {/* Heatmap Tooltip */}
        {hoveredHeatmapCell && (
          <div style={{
            position: 'absolute',
            left: `${hoveredHeatmapCell.x}px`,
            top: `${hoveredHeatmapCell.y}px`,
            transform: 'translateX(-50%)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 8px',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-base)',
            pointerEvents: 'none',
            zIndex: 100,
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-md)',
            animation: 'tooltip-in 100ms var(--ease-enter)'
          }}>
            <strong>{hoveredHeatmapCell.count} logs</strong> on {hoveredHeatmapCell.dateStr}
          </div>
        )}
      </div>

      {/* Two-Column Middle Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(400px, 100%), 1fr))', gap: 'var(--space-4)' }}>
        {/* Weekly Completed Tasks Graph */}
        <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', position: 'relative' }}>
          <div className="row">
            <IconChart style={{ color: 'var(--color-primary)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Weekly Finished Items</span>
          </div>

          {data.tasksCompletedWeekly.length === 0 ? (
            <div style={{ height: `${weeklyHeight}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
              No completed Kanban tasks recorded yet.
            </div>
          ) : (
            <div style={{ position: 'relative', width: '100%' }}>
              <svg width="100%" height={weeklyHeight} viewBox={`0 0 ${weeklyWidth} ${weeklyHeight}`} preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="weekly-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Gridlines */}
                {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
                  const y = linePadding.top + r * lineChartH
                  const value = Math.round(maxWeeklyCount * (1 - r))
                  return (
                    <g key={i}>
                      <line x1={linePadding.left} y1={y} x2={weeklyWidth - linePadding.right} y2={y} stroke="var(--color-surface-offset)" strokeWidth="1" />
                      <text x={linePadding.left - 8} y={y + 4} textAnchor="end" fill="var(--color-text-faint)" style={{ fontSize: '9px' }}>{value}</text>
                    </g>
                  )
                })}

                {/* Gradient area */}
                {areaD && <path d={areaD} fill="url(#weekly-grad)" />}

                {/* Line path */}
                {pathD && <path d={pathD} fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}

                {/* Interactive Points */}
                {linePoints.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="4" fill="var(--color-surface-1)" stroke="var(--color-primary)" strokeWidth="2.5" className="hover-line-point" />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="16"
                      fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const parentRect = e.currentTarget.closest('.analytics-card')?.getBoundingClientRect()
                        setHoveredLinePoint({
                          week: p.week,
                          count: p.count,
                          x: rect.left - (parentRect?.left || 0) + 5,
                          y: rect.top - (parentRect?.top || 0) - 34
                        })
                      }}
                      onMouseLeave={() => setHoveredLinePoint(null)}
                    />
                  </g>
                ))}

                {/* X axis week labels */}
                {linePoints.map((p, i) => {
                  const currentYear = p.week.substring(0, 4)
                  const prevYear = i > 0 ? linePoints[i - 1].week.substring(0, 4) : null
                  const showYear = i === 0 || (prevYear && currentYear !== prevYear)
                  const label = showYear ? p.week : p.week.substring(5)
                  return (
                    <text
                      key={i}
                      x={p.x}
                      y={weeklyHeight - 8}
                      textAnchor="middle"
                      fill="var(--color-text-muted)"
                      style={{ fontSize: '9px' }}
                    >
                      {label}
                    </text>
                  )
                })}
              </svg>

              {hoveredLinePoint && (
                <div style={{
                  position: 'absolute',
                  left: `${hoveredLinePoint.x}px`,
                  top: `${hoveredLinePoint.y}px`,
                  transform: 'translateX(-50%)',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-base)',
                  pointerEvents: 'none',
                  zIndex: 100,
                  whiteSpace: 'nowrap',
                  boxShadow: 'var(--shadow-md)',
                  animation: 'tooltip-in 100ms var(--ease-enter)'
                }}>
                  <strong>{hoveredLinePoint.count} items</strong> ({hoveredLinePoint.week})
                </div>
              )}
            </div>
          )}
        </div>

        {/* Kanban Cycle Time Duration Chart */}
        <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', position: 'relative' }}>
          <div className="row">
            <IconClock style={{ color: 'var(--color-secondary)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Average Column Duration (Cycle Time)</span>
          </div>

          {data.columnTime.length === 0 ? (
            <div style={{ height: `${barHeight}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
              No Kanban cycle time data recorded.
            </div>
          ) : (
            <div style={{ position: 'relative', width: '100%' }}>
              <svg width="100%" height={barHeight} viewBox={`0 0 ${barWidth} ${barHeight}`} preserveAspectRatio="xMidYMid meet">
                {/* Horizontal guide lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
                  const y = barPadding.top + r * barChartH
                  const value = formatDuration(maxBarMs * (1 - r))
                  return (
                    <g key={i}>
                      <line x1={barPadding.left} y1={y} x2={barWidth - barPadding.right} y2={y} stroke="var(--color-surface-offset)" strokeWidth="1" />
                      <text x={barPadding.left - 8} y={y + 4} textAnchor="end" fill="var(--color-text-faint)" style={{ fontSize: '9px' }}>{value}</text>
                    </g>
                  )
                })}

                {/* Bars */}
                {data.columnTime.map((d, i) => {
                  const colCount = data.columnTime.length
                  const colSpacing = barChartW / colCount
                  const x = barPadding.left + i * colSpacing + (colSpacing - renderBarW) / 2
                  const barH = (d.avgMs / maxBarMs) * barChartH
                  const y = barPadding.top + barChartH - barH

                  return (
                    <g key={i}>
                      <rect
                        x={x}
                        y={y}
                        width={renderBarW}
                        height={Math.max(barH, 3)}
                        rx="3"
                        fill="var(--color-secondary)"
                        style={{ cursor: 'pointer', transition: 'fill var(--duration-fast) var(--ease-default)' }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          const parentRect = e.currentTarget.closest('.analytics-card')?.getBoundingClientRect()
                          setHoveredBar({
                            column: d.column,
                            avgMs: d.avgMs,
                            x: rect.left - (parentRect?.left || 0) + renderBarW / 2,
                            y: rect.top - (parentRect?.top || 0) - 34
                          })
                        }}
                        onMouseLeave={() => setHoveredBar(null)}
                      />
                      <text
                        x={x + renderBarW / 2}
                        y={barHeight - 8}
                        textAnchor="middle"
                        fill="var(--color-text-muted)"
                        style={{ fontSize: '9px', textTransform: 'capitalize' }}
                      >
                        {formatColumnLabel(d.column)}
                      </text>
                    </g>
                  )
                })}
              </svg>

              {hoveredBar && (
                <div style={{
                  position: 'absolute',
                  left: `${hoveredBar.x}px`,
                  top: `${hoveredBar.y}px`,
                  transform: 'translateX(-50%)',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-base)',
                  pointerEvents: 'none',
                  zIndex: 100,
                  whiteSpace: 'nowrap',
                  boxShadow: 'var(--shadow-md)',
                  animation: 'tooltip-in 100ms var(--ease-enter)'
                }}>
                  <strong>{formatDuration(hoveredBar.avgMs)}</strong> avg time in <span style={{ textTransform: 'capitalize' }}>{formatColumnLabel(hoveredBar.column)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Grid Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(400px, 100%), 1fr))', gap: 'var(--space-4)' }}>
        {/* Context Focus Allocation (Passive Tracker) */}
        <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="row">
            <IconChart style={{ color: 'var(--color-secondary)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Context Focus Allocation (Past 7 Days)</span>
          </div>

          {data.activityAllocation.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)', minHeight: '140px' }}>
              No activity logs recorded yet. Enable the tracker in settings.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {(() => {
                const totalActivityMins = data.activityAllocation.reduce((acc, a) => acc + a.durationMins, 0)
                return data.activityAllocation.map((act, i) => {
                  const percentage = totalActivityMins > 0 ? (act.durationMins / totalActivityMins) * 100 : 0
                  const barColor = ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]
                  const hrs = Math.floor(act.durationMins / 60)
                  const mins = act.durationMins % 60
                  const durationStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`

                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'var(--weight-medium)' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: barColor }} />
                          {act.context.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                        <span style={{ color: 'var(--color-text-muted)' }}>{durationStr} ({percentage.toFixed(0)}%)</span>
                      </div>
                      <div style={{ height: '6px', width: '100%', background: 'var(--color-surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${percentage}%`, background: barColor, borderRadius: '3px', transition: 'width 300ms ease' }} />
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>

        {/* Most Used Tags */}
        <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="row">
            <IconTag style={{ color: 'var(--color-secondary)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Tag Usage Share</span>
          </div>

          {data.mostUsedTags.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)', minHeight: '140px' }}>
              No tag references found. Add tags to items.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {data.mostUsedTags.map((tag, i) => {
                const percentage = totalTagUses > 0 ? (tag.count / totalTagUses) * 100 : 0
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'var(--weight-medium)' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: tag.color }} />
                        {tag.name}
                      </span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{tag.count} uses ({percentage.toFixed(0)}%)</span>
                    </div>
                    {/* Progress Bar Container */}
                    <div style={{ height: '6px', width: '100%', background: 'var(--color-surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${percentage}%`, background: tag.color, borderRadius: '3px', transition: 'width 300ms ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Focus Retrospective Logs */}
        <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="row">
            <IconFocus style={{ color: 'var(--color-primary)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Focus Retrospective Log</span>
          </div>

          {data.recentFocusSessions.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)', minHeight: '140px' }}>
              No focus session records found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', overflowY: 'auto', maxHeight: '180px', paddingRight: '2px' }}>
              {data.recentFocusSessions.map((session, i) => (
                <div key={i} style={{
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--color-surface-2)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  borderLeft: '3px solid var(--color-primary)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-semibold)' }}>
                      {session.durationMinutes} min session
                    </span>
                    <span style={{ color: 'var(--color-text-faint)', fontSize: '10px' }}>
                      {formatDate(session.completedAt)}
                    </span>
                  </div>
                  {session.context && (
                    <div style={{ fontSize: '10px', color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Context: {session.context}
                    </div>
                  )}
                  {session.notes && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                      &ldquo;{session.notes}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </>
      ) : (
        renderTimelineView()
      )}
      </div>
    </div>
  )
}
