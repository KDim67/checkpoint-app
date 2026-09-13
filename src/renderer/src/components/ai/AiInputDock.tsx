import { X, Brain, FolderOpen, Gauge, ArrowDown } from 'lucide-react'
import ChatInput from './ChatInput'
import { AI_SKILLS, getSkillById } from './skills'
import { classifyIntent, detectSkill } from './aiHelpers'
import type { AiStreamPanelState } from './useAiStreamPanel'

export default function AiInputDock({ panel }: { panel: AiStreamPanelState }) {
  const {
    inputValue, setInputValue, isStreaming, contextItem, modelCaps, isAtBottomRef, recalledMemCount,
    setShowMemoryPanel, activeSkillId, workspaceFolder, workspaceFiles, handleClearWorkspace,
    customActions, setShowCustomActionsModal, scrollToBottom, showJumpToLatest, setShowJumpToLatest,
    handleSelectSkill, handleSubmitWithText, handleSubmit, handleAbort, tokenUsage
  } = panel
  return (
    <div
      style={{
        padding: 'var(--space-3) var(--space-4) var(--space-4)',
        borderTop: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)',
        flexShrink: 0,
        position: 'relative'
      }}
    >
      {showJumpToLatest && (
        <button
          onClick={() => {
            isAtBottomRef.current = true
            setShowJumpToLatest(false)
            scrollToBottom(true)
          }}
          title="Jump to the latest message"
          style={{
            position: 'absolute',
            top: '-40px',
            right: 'var(--space-4)',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-base)',
            borderRadius: '999px',
            padding: '5px 12px',
            fontSize: '10px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
          }}
        >
          <ArrowDown size={12} className="text-accent" />
          <span>{isStreaming ? 'Following live…' : 'Latest'}</span>
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {(() => {
          const resolvedAutoSkillId = (() => {
            if (activeSkillId) return null
            const skill = detectSkill(inputValue)
            if (skill) return skill
            const intent = classifyIntent(inputValue, null)
            if (intent === 'create_dialogue') return 'narrative_specialist'
            if (intent === 'create_plan') return 'implementation_planner'
            return null
          })()

          return AI_SKILLS.map(skill => {
            const isManualActive = activeSkillId === skill.id
            const isAutoActive = !activeSkillId && resolvedAutoSkillId === skill.id
            const isActive = isManualActive || isAutoActive
            return (
              <button
                key={skill.id}
                onClick={() => handleSelectSkill(skill.id)}
                title={skill.description}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  background: isActive ? `${skill.color}22` : 'var(--color-surface-2)',
                  border: `1px solid ${isActive ? skill.color : 'var(--color-surface-offset)'}`,
                  color: isActive ? skill.color : 'var(--color-text-muted)',
                  borderRadius: '999px',
                  padding: '3px 10px',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 100ms ease'
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isActive ? skill.color : 'var(--color-text-faint)', flexShrink: 0 }} />
                <span>{skill.shortLabel}{isAutoActive ? ' (auto)' : ''}</span>
              </button>
            )
          })
        })()}

        {workspaceFolder && (
          <div
            title={`${workspaceFolder}, ${workspaceFiles.length} files indexed`}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)',
              color: 'var(--color-info)', borderRadius: '999px', padding: '3px 8px 3px 10px',
              fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap'
            }}
          >
            <FolderOpen size={11} />
            <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {workspaceFolder.split(/[\\/]/).pop()} ({workspaceFiles.length})
            </span>
            <button
              onClick={handleClearWorkspace}
              title="Remove imported workspace"
              style={{ background: 'transparent', border: 'none', color: 'var(--color-info)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
            >
              <X size={11} />
            </button>
          </div>
        )}

        {recalledMemCount > 0 && (
          <button
            onClick={() => setShowMemoryPanel(true)}
            title={`${recalledMemCount} project memories were recalled for the last message. Click to open the Memory Vault.`}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.4)',
              color: 'var(--color-accent-ai-soft)', borderRadius: '999px', padding: '3px 10px',
              fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap', cursor: 'pointer'
            }}
          >
            <Brain size={11} />
            <span>{recalledMemCount} recalled</span>
          </button>
        )}

        <div
          title={`${tokenUsage.measured ? '' : '~'}${tokenUsage.used.toLocaleString()} / ${modelCaps.contextTokens.toLocaleString()} tokens of context window in use${tokenUsage.measured ? ' (reported by the endpoint)' : ' (estimated)'}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            marginLeft: 'auto', flexShrink: 0
          }}
        >
          <Gauge size={11} style={{ color: tokenUsage.ratio > 0.85 ? '#ef4444' : tokenUsage.ratio > 0.6 ? '#eab308' : 'var(--color-text-faint)' }} />
          <div style={{ width: '56px', height: '4px', borderRadius: '2px', background: 'var(--color-surface-offset)', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.max(2, tokenUsage.ratio * 100)}%`,
              height: '100%',
              background: tokenUsage.ratio > 0.85 ? '#ef4444' : tokenUsage.ratio > 0.6 ? '#eab308' : 'var(--color-secondary)',
              transition: 'width 200ms ease'
            }} />
          </div>
          <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
            {Math.round(tokenUsage.ratio * 100)}%
          </span>
        </div>
      </div>

      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        onAbort={handleAbort}
        isStreaming={isStreaming}
        contextItem={contextItem}
        onTriggerPrompt={(prompt, displayContent, intentHint) => handleSubmitWithText(prompt, { displayContent, intentHint })}
        activeSkill={getSkillById(activeSkillId)}
        onClearSkill={() => handleSelectSkill(null)}
        workspaceFiles={workspaceFiles.map(f => ({ name: f.name, relativePath: f.relativePath }))}
        customActions={customActions}
        onManageCustomActions={() => setShowCustomActionsModal(true)}
        visionCapable={modelCaps.supportsVision}
      />
    </div>
  )
}
