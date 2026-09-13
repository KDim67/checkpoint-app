import { Check, Award, Coffee } from 'lucide-react'
import type { FocusViewState } from './useFocusView'

export default function FocusRetro({ focusView }: { focusView: FocusViewState }) {
  const {
    elapsedTimeMs, cyclesCompleted, distractions, retroNotes, setRetroNotes, retroTasks,
    setShowDiscardConfirm, handleToggleRetroTask, handleSaveRetrospective, handleStartBreak,
    longBreakDue
  } = focusView
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 0 }}>
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '540px',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
          padding: 'var(--space-6)'
        }}
      >
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Award />
            Interval Retrospective
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: '2px' }}>
            Verify completed tasks and record any notes about this session.
          </p>
        </div>

        {/* At-a-glance session stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
          {[
            { label: 'Focused', value: `${Math.max(1, Math.round(elapsedTimeMs / 60000))}m`, color: 'var(--color-secondary)' },
            { label: 'Tasks done', value: `${retroTasks.filter(t => t.completed).length}/${retroTasks.length}`, color: 'var(--color-text-base)' },
            { label: 'Interruptions', value: `${distractions}`, color: distractions > 0 ? '#f59e0b' : 'var(--color-text-base)' }
          ].map(stat => (
            <div
              key={stat.label}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                textAlign: 'center'
              }}
            >
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: stat.color, lineHeight: 1 }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginTop: '4px' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Long-break cadence nudge. Surfaces the classic 4-interval rule */}
        {longBreakDue && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(139, 92, 246, 0.12)',
            border: '1px solid rgba(139, 92, 246, 0.4)',
            color: '#a78bfa',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-medium)'
          }}>
            <Coffee size={15} />
            Nice streak. You&rsquo;ve completed {cyclesCompleted} focus intervals. A long break is recommended.
          </div>
        )}

        {/* Check completed checklist */}
        <div className="col">
          <h3 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
            Verify Completed Tasks
          </h3>
          {retroTasks.length === 0 ? (
            <div style={{ fontStyle: 'italic', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
              No tasks selected for this session.
            </div>
          ) : (
            retroTasks.map(t => (
              <div
                key={t.id}
                onClick={() => handleToggleRetroTask(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  cursor: 'pointer'
                }}
              >
                <div className={`retro-checkbox ${t.completed ? 'checked' : ''}`}>
                  {t.completed && <Check size={12} strokeWidth={3} />}
                </div>
                <span style={{
                  fontSize: 'var(--text-xs)',
                  color: t.completed ? 'var(--color-text-muted)' : 'var(--color-text-base)',
                  textDecoration: t.completed ? 'line-through' : 'none'
                }}>
                  {t.title}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Retrospective Text Input */}
        <div className="col">
          <label
            htmlFor="retro-notes-area"
            style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}
          >
            What did you accomplish or learn? (Retrospective Notes)
          </label>
          <textarea
            id="retro-notes-area"
            value={retroNotes}
            onChange={e => setRetroNotes(e.target.value)}
            placeholder="Write down any takeaways, obstacles, or design decisions reached during this block..."
            rows={4}
            style={{
              width: '100%',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-base)',
              padding: 'var(--space-3)',
              fontSize: 'var(--text-sm)',
              lineHeight: 'var(--leading-normal)',
              resize: 'none',
              outline: 'none',
              transition: 'border-color var(--duration-fast)'
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-secondary)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button
              className="btn-ghost"
              onClick={() => handleStartBreak('short-break')}
              title="Save this session and start a 5-minute break"
              style={{
                fontSize: 'var(--text-xs)',
                borderColor: longBreakDue ? 'var(--color-surface-offset)' : '#10b981',
                color: longBreakDue ? 'var(--color-text-muted)' : '#10b981'
              }}
            >
              <Coffee size={14} /> Short Break · 5m
            </button>
            <button
              className="btn-ghost"
              onClick={() => handleStartBreak('long-break')}
              title="Save this session and start a 15-minute break"
              style={{
                fontSize: 'var(--text-xs)',
                borderColor: longBreakDue ? '#8b5cf6' : 'var(--color-surface-offset)',
                color: longBreakDue ? '#a78bfa' : 'var(--color-text-muted)'
              }}
            >
              <Coffee size={14} /> Long Break · 15m
            </button>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              onClick={() => setShowDiscardConfirm(true)}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-muted)',
                padding: '8px 16px',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--color-surface-offset)'
                e.currentTarget.style.color = 'var(--color-error)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--color-text-muted)'
              }}
            >
              Discard
            </button>

            <button
              onClick={handleSaveRetrospective}
              className="btn-volt"
            >
              <Check size={16} />
              Save &amp; Log Session
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
