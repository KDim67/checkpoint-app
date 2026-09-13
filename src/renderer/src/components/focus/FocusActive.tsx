import { Play, Pause, X, Check, RotateCcw, SkipForward, Zap } from 'lucide-react'
import { TIMER_PRESETS, formatTime, durationMsFor, type TimerPreset } from './pomodoroTimer'
import type { FocusViewState } from './useFocusView'

export default function FocusActive({ focusView }: { focusView: FocusViewState }) {
  const {
    selectedTasks, preset, timeLeftMs, isRunning, focusSettings, distractions, focusSetPreset,
    focusStart, focusLogDistraction, handleToggleTimer, handleResetTimer, handleSkipTimer,
    handleCancelSession, handleToggleTaskDoneActive, progressPercent, projectedEnd, activeColor
  } = focusView
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0, padding: 'var(--space-4)' }}>
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '520px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-6)',
          padding: 'var(--space-6) var(--space-8)',
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          position: 'relative'
        }}
      >
        {/* Header Row: Preset pills, cycle dots & Cancel button */}
        <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-4)' }}>
          {/* Preset mode pills. Locked while running to avoid accidentally nuking progress */}
          <div
            style={{ display: 'flex', gap: '6px', background: 'var(--color-surface-2)', padding: '3px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-surface-offset)', opacity: isRunning ? 0.5 : 1 }}
            title={isRunning ? 'Pause the timer to switch modes' : undefined}
          >
            {(Object.keys(TIMER_PRESETS) as TimerPreset[]).map(pKey => {
              const pConfig = TIMER_PRESETS[pKey]
              const isAct = preset === pKey
              const pColor = pKey === 'focus' ? 'var(--color-secondary)' : (pKey === 'short-break' ? '#10b981' : '#8b5cf6')
              return (
                <button
                  key={pKey}
                  disabled={isRunning}
                  onClick={() => {
                    focusSetPreset(pKey)
                    focusStart(durationMsFor(focusSettings, pKey))
                  }}
                  style={{
                    padding: '4px 12px',
                    fontSize: '11px',
                    fontWeight: 'var(--weight-bold)',
                    borderRadius: 'var(--radius-full)',
                    border: 'none',
                    background: isAct ? pColor : 'transparent',
                    color: isAct ? (pKey === 'focus' ? '#0f172a' : '#ffffff') : 'var(--color-text-muted)',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    transition: 'all 150ms ease'
                  }}
                >
                  {pConfig.label}
                </button>
              )
            })}
          </div>

          {/* End / Cancel session */}
          <button
            onClick={handleCancelSession}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-medium)',
              transition: 'all 100ms ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-error)'
              e.currentTarget.style.borderColor = 'var(--color-error)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-muted)'
              e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
            }}
          >
            <X size={13} />
            End Session
          </button>
        </div>

        {/* Clock Dial & Progress Ring */}
        <div className={isRunning ? 'timer-ring-active' : undefined} style={{ position: 'relative', width: '250px', height: '250px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '10px 0' }}>
          <svg width="250" height="250" style={{ transform: 'rotate(-90deg)', position: 'absolute', top: 0, left: 0 }}>
            {/* Background ring */}
            <circle
              cx="125"
              cy="125"
              r="98"
              fill="transparent"
              stroke="var(--color-surface-offset)"
              strokeWidth="10"
            />
            {/* Active filled ring */}
            <circle
              role="progressbar"
              aria-valuenow={Math.round(progressPercent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Focus timer progress"
              cx="125"
              cy="125"
              r="98"
              fill="transparent"
              stroke={activeColor}
              strokeWidth="10"
              strokeDasharray={2 * Math.PI * 98}
              strokeDashoffset={2 * Math.PI * 98 * (1 - (progressPercent / 100))}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.3s ease', filter: `drop-shadow(0 0 8px ${activeColor}50)` }}
            />
          </svg>

          {/* Readout inside Circle */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <span style={{
              fontSize: '10px',
              fontWeight: 'var(--weight-bold)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-widest)',
              color: activeColor
            }}>
              {preset === 'focus' ? 'Focus Interval' : preset.replace('-', ' ')}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '40px',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--color-text-base)',
              letterSpacing: '-0.03em',
              lineHeight: 1
            }}>
              {formatTime(timeLeftMs)}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-medium)' }}>
              {isRunning
                ? (projectedEnd ? `ends ~${projectedEnd} · Space to pause` : 'Space to pause')
                : 'paused · Space to resume'}
            </span>
          </div>
        </div>

        {/* Controls Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={handleResetTimer}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 120ms ease'
            }}
            title="Reset Interval"
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-text-base)'
              e.currentTarget.style.borderColor = 'var(--color-balance)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-muted)'
              e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
            }}
          >
            <RotateCcw size={18} />
          </button>

          <button
            onClick={handleToggleTimer}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: activeColor,
              border: 'none',
              color: (preset === 'focus' ? '#0f172a' : '#ffffff'),
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 4px 14px ${activeColor}40`,
              transition: 'all 150ms ease',
              transform: 'scale(1)'
            }}
            title={isRunning ? 'Pause' : 'Resume'}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.06)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {isRunning ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" style={{ marginLeft: '3px' }} />}
          </button>

          <button
            onClick={handleSkipTimer}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 120ms ease'
            }}
            title="Skip Interval / Retrospective"
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-text-base)'
              e.currentTarget.style.borderColor = 'var(--color-balance)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-muted)'
              e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
            }}
          >
            <SkipForward size={18} />
          </button>
        </div>

        {/* Distraction tally. A Pomodoro staple: acknowledge the interruption,
            keep working, review the count in the retro. Focus intervals only. */}
        {preset === 'focus' && (
          <button
            onClick={focusLogDistraction}
            title="Log an interruption without breaking focus (press D)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: 'var(--radius-full)',
              background: distractions > 0 ? 'rgba(245, 158, 11, 0.12)' : 'var(--color-surface-2)',
              border: `1px solid ${distractions > 0 ? 'rgba(245, 158, 11, 0.4)' : 'var(--color-surface-offset)'}`,
              color: distractions > 0 ? '#f59e0b' : 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              marginTop: 'calc(-1 * var(--space-2))',
              transition: 'all var(--duration-fast) var(--ease-default)'
            }}
          >
            <Zap size={13} fill={distractions > 0 ? 'currentColor' : 'none'} />
            {distractions === 0
              ? 'Log a distraction'
              : `${distractions} distraction${distractions === 1 ? '' : 's'} logged`}
          </button>
        )}

        {/* Focus Targets checklist. Hidden for breaks, since there are no tasks to work a break */}
        {preset === 'focus' && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)', borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <h4 style={{
                fontSize: '10px',
                fontWeight: 'var(--weight-bold)',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-wide)',
                margin: 0
              }}>
                Current Focus Targets
              </h4>
              <span style={{ fontSize: '10px', color: 'var(--color-secondary)', fontWeight: 'var(--weight-bold)' }}>
                {selectedTasks.filter(t => t.status === 'done').length} / {selectedTasks.length} Done
              </span>
            </div>

            {selectedTasks.length === 0 ? (
              <div style={{ fontStyle: 'italic', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
                No tasks selected for this session.
              </div>
            ) : (
              selectedTasks.map(task => {
                const isCompleted = task.status === 'done'
                return (
                  <div
                    key={task.id}
                    onClick={() => handleToggleTaskDoneActive(task)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      background: isCompleted ? 'var(--color-surface-offset)' : 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      cursor: 'pointer',
                      opacity: isCompleted ? 0.6 : 1,
                      transition: 'all var(--duration-fast)'
                    }}
                  >
                    <div className={`retro-checkbox ${isCompleted ? 'checked' : ''}`}>
                      {isCompleted && <Check size={12} strokeWidth={3} />}
                    </div>
                    <span style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--weight-medium)',
                      color: isCompleted ? 'var(--color-text-muted)' : 'var(--color-text-base)',
                      textDecoration: isCompleted ? 'line-through' : 'none'
                    }}>
                      {task.title}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
