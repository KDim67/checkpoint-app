import { Play, Check, Timer, Award, ArrowRight, BookOpen, Plus, Flame } from 'lucide-react'
import { TIMER_PRESETS, type TimerPreset } from './pomodoroTimer'
import { saveAutoStartNext, saveChimeEnabled, saveChimeVolume, saveNotificationsEnabled } from '../../lib/focusSettings'
import { ToggleSwitch } from '../settings/SettingsSection'
import type { FocusViewState } from './useFocusView'

function FocusOptionToggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="row-between">
      <span className="text-hint">{label}</span>
      <ToggleSwitch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

export default function FocusSetup({ focusView }: { focusView: FocusViewState }) {
  const {
    setView, selectedTasks, preset, customMinutes, cyclesCompleted, focusSettings, focusSetPreset,
    focusSetCustomMinutes, dbItems, loading, quickAddText, setQuickAddText, addingTask, pastSessions,
    handleStartSession, handleToggleTaskSelection, handleQuickAddTask, applyFocusOption,
    handleCadenceChange, handleDurationChange, todayStats, cycleDots
  } = focusView
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 'var(--space-6)', flex: 1, minHeight: 0 }}>
      {/* Left panel: Task Picker */}
      <div className="col-lg-min">
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <div className="row">
              <Timer className="text-accent" />
              <span>Daily Focus Session</span>
            </div>
            <span style={{
              fontSize: 'var(--text-2xs)',
              fontWeight: 'var(--weight-bold)',
              background: selectedTasks.length === 3 ? 'var(--color-secondary-muted)' : 'var(--color-surface-offset)',
              color: selectedTasks.length === 3 ? 'var(--color-secondary)' : 'var(--color-text-muted)',
              border: `1px solid ${selectedTasks.length === 3 ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)'
            }}>
              {selectedTasks.length}/3 selected
            </span>
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
              Select up to 3 tasks to complete during this interval. Quiet your environment and focus.
            </p>
            {todayStats.count > 0 && (
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: 'var(--text-2xs)',
                fontWeight: 'var(--weight-bold)',
                color: 'var(--color-secondary)',
                whiteSpace: 'nowrap'
              }}>
                <Flame size={12} />
                {todayStats.minutes}m focused today ({todayStats.count} {todayStats.count === 1 ? 'session' : 'sessions'})
              </span>
            )}
          </div>
        </div>

        {/* Quick-add: jot a task straight into today's focus list without leaving the view */}
        <div className="flex-gap">
          <input
            className="quick-add-input"
            type="text"
            placeholder="Quick-add a task and focus on it..."
            value={quickAddText}
            onChange={e => setQuickAddText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !addingTask) handleQuickAddTask()
            }}
          />
          <button
            className="btn-ghost"
            onClick={handleQuickAddTask}
            disabled={addingTask || !quickAddText.trim()}
            style={{ opacity: addingTask || !quickAddText.trim() ? 0.5 : 1, cursor: addingTask || !quickAddText.trim() ? 'not-allowed' : 'pointer', padding: '8px 12px' }}
          >
            <Plus size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingRight: '4px' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '120px', color: 'var(--color-text-muted)' }}>
              Loading uncompleted backlog and board items...
            </div>
          ) : dbItems.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', border: '1px dashed var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', color: 'var(--color-text-muted)' }}>
              <Award style={{ width: '32px', height: '32px', margin: '0 auto var(--space-3)', opacity: 0.5 }} />
              <p style={{ fontWeight: 'var(--weight-semibold)' }}>All caught up!</p>
              <p style={{ fontSize: 'var(--text-xs)', marginTop: '2px' }}>Add a task above, or pull cards in from Backlog/Kanban.</p>
            </div>
          ) : (
            dbItems.map(item => {
              const isSelected = selectedTasks.some(t => t.id === item.id)
              const priorityLabels = ['None', 'Low', 'Med', 'High']
              const priorityColors = [
                'var(--color-priority-none)',
                'var(--color-priority-low)',
                'var(--color-priority-med)',
                'var(--color-priority-high)'
              ]

              return (
                <div
                  key={item.id}
                  className={`task-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleToggleTaskSelection(item)}
                >
                  <div
                    className={`retro-checkbox ${isSelected ? 'checked' : ''}`}
                    onClick={e => {
                      e.stopPropagation()
                      handleToggleTaskSelection(item)
                    }}
                  >
                    {isSelected && <Check size={12} strokeWidth={3} />}
                  </div>

                  <div className="flex-1">
                    <div className="text-label">{item.title}</div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{
                        fontSize: 'var(--text-2xs)',
                        color: 'var(--color-text-muted)',
                        background: 'var(--color-surface-offset)',
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-sm)',
                        textTransform: 'capitalize'
                      }}>
                        {item.type}
                      </span>

                      {item.priority > 0 && (
                        <span
                          className="priority-badge"
                          style={{
                            background: priorityColors[item.priority] + '15',
                            color: priorityColors[item.priority]
                          }}
                        >
                          {priorityLabels[item.priority]}
                        </span>
                      )}

                      {item.tags && item.tags.map(tag => (
                        <span
                          key={tag.id}
                          className="tag-badge"
                          style={{
                            background: tag.color + '15',
                            color: tag.color,
                            border: `1px solid ${tag.color}33`
                          }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Right panel: Controls & Stats */}
      <div className="col-lg">
        {/* Presets Card */}
        <div className="glass-panel col-lg">
          <div className="row-between">
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', margin: 0 }}>Timer Config</h3>
            {/* Fills one dot per completed focus interval, resetting each time a long break comes due */}
            <div className="flex-4px" title={`${cyclesCompleted} focus intervals completed this session`}>
              {Array.from({ length: focusSettings.longBreakInterval }, (_, i) => i).map(i => (
                <span key={i} className={`cycle-dot ${i < cycleDots || (cycleDots === 0 && cyclesCompleted > 0 && i < focusSettings.longBreakInterval) ? 'filled' : ''}`} />
              ))}
            </div>
          </div>

          <div className="col">
            {(Object.keys(TIMER_PRESETS) as TimerPreset[]).map(key => (
              <button
                key={key}
                onClick={() => focusSetPreset(key)}
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: preset === key ? 'var(--color-surface-offset)' : 'transparent',
                  border: `1px solid ${preset === key ? 'var(--color-balance)' : 'var(--color-surface-offset)'}`,
                  color: preset === key ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: preset === key ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                  transition: 'all var(--duration-fast) var(--ease-default)'
                }}
              >
                <div className="row-between-full">
                  <span>{TIMER_PRESETS[key].label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                    {focusSettings.durations[key]}m
                  </span>
                </div>

                {preset === key && (
                  <input
                    type="range"
                    min="1"
                    max="120"
                    aria-label={`${TIMER_PRESETS[key].label} length in minutes`}
                    value={focusSettings.durations[key]}
                    onClick={e => e.stopPropagation()}
                    onChange={e => handleDurationChange(key, Number(e.target.value))}
                    style={{
                      width: '100%',
                      accentColor: 'var(--color-secondary)',
                      background: 'var(--color-surface-2)',
                      height: '4px',
                      borderRadius: '2px',
                      cursor: 'pointer',
                      marginTop: '4px'
                    }}
                  />
                )}
              </button>
            ))}

            <button
              onClick={() => focusSetPreset('custom')}
              style={{
                width: '100%',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background: preset === 'custom' ? 'var(--color-surface-offset)' : 'transparent',
                border: `1px solid ${preset === 'custom' ? 'var(--color-balance)' : 'var(--color-surface-offset)'}`,
                color: preset === 'custom' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                fontSize: 'var(--text-sm)',
                fontWeight: preset === 'custom' ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                transition: 'all var(--duration-fast) var(--ease-default)'
              }}
            >
              <div className="row-between-full">
                <span>Custom Timer</span>
                {preset === 'custom' && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                    {customMinutes}m
                  </span>
                )}
              </div>

              {preset === 'custom' && (
                <input
                  type="range"
                  min="1"
                  max="120"
                  value={customMinutes}
                  onClick={e => e.stopPropagation()}
                  onChange={e => focusSetCustomMinutes(Number(e.target.value))}
                  style={{
                    width: '100%',
                    accentColor: 'var(--color-secondary)',
                    background: 'var(--color-surface-2)',
                    height: '4px',
                    borderRadius: '2px',
                    cursor: 'pointer',
                    marginTop: '4px'
                  }}
                />
              )}
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="row-between">
              <label htmlFor="focus-cadence" className="text-hint">
                Long break every
              </label>
              <div className="row" style={{ gap: 'var(--space-2)' }}>
                <input
                  id="focus-cadence"
                  type="number"
                  min="2"
                  max="12"
                  value={focusSettings.longBreakInterval}
                  onChange={e => handleCadenceChange(Number(e.target.value))}
                  style={{
                    width: '52px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '2px var(--space-2)',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-mono)',
                    textAlign: 'right'
                  }}
                />
                <span className="text-hint-faint">intervals</span>
              </div>
            </div>

            <FocusOptionToggle
              label="Auto-start next interval"
              checked={focusSettings.autoStartNext}
              onChange={value => applyFocusOption({ autoStartNext: value }, saveAutoStartNext(value))}
            />
            <FocusOptionToggle
              label="Chime on completion"
              checked={focusSettings.chimeEnabled}
              onChange={value => applyFocusOption({ chimeEnabled: value }, saveChimeEnabled(value))}
            />
            {focusSettings.chimeEnabled && (
              <div className="row-between">
                <label htmlFor="focus-volume" className="text-hint">
                  Chime volume
                </label>
                <input
                  id="focus-volume"
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(focusSettings.chimeVolume * 100)}
                  onChange={e => {
                    const volume = Number(e.target.value) / 100
                    applyFocusOption({ chimeVolume: volume }, saveChimeVolume(volume))
                  }}
                  style={{ width: '120px', accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
                />
              </div>
            )}
            <FocusOptionToggle
              label="Desktop notification"
              checked={focusSettings.notificationsEnabled}
              onChange={value => applyFocusOption({ notificationsEnabled: value }, saveNotificationsEnabled(value))}
            />
          </div>

          <button
            className="btn-volt"
            disabled={selectedTasks.length === 0}
            onClick={handleStartSession}
            style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
          >
            <Play size={16} fill="currentColor" />
            Start Focus Mode
          </button>
        </div>

        {/* History Panel */}
        <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minHeight: 0 }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <BookOpen size={14} />
            Recent History
          </h3>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {pastSessions.length === 0 ? (
              <div style={{ padding: 'var(--space-4) 0', color: 'var(--color-text-faint)', textAlign: 'center', fontSize: 'var(--text-xs)' }}>
                No sessions logged yet in this context.
              </div>
            ) : (
              pastSessions.map(session => {
                const minutes = Math.round(session.duration_ms / 60000)
                const date = new Date(session.completed_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
                let taskCount = 0
                try {
                  taskCount = JSON.parse(session.tasks_json || '[]').length
                } catch {}

                return (
                  <div
                    key={session.id}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-3)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <div className="row-caption-xs">
                      <span className="text-label">
                        {minutes}m Session
                      </span>
                      <span className="text-faint">{date}</span>
                    </div>
                    {session.notes && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic', wordBreak: 'break-word' }}>
                        &ldquo;{session.notes.length > 60 ? `${session.notes.slice(0, 60)}...` : session.notes}&rdquo;
                      </div>
                    )}
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-secondary)' }}>
                      {taskCount} {taskCount === 1 ? 'task' : 'tasks'} focused
                    </div>
                  </div>
                )
              })
            )}
            {pastSessions.length > 0 && (
              <button
                onClick={() => setView('analytics')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-secondary)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                  textAlign: 'center',
                  marginTop: 'var(--space-2)',
                  padding: 'var(--space-1) 0',
                  alignSelf: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'filter 120ms ease'
                }}
                onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.15)'}
                onMouseLeave={e => e.currentTarget.style.filter = 'none'}
              >
                View all in Analytics <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
