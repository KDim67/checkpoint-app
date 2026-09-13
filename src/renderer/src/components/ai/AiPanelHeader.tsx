import { RefreshCw, MessageSquare, Plus, Brain, Sliders, FileDown, FolderOpen } from 'lucide-react'
import { isLocalUrl } from './aiProviders'
import ModelCapabilityBar from './ModelCapabilityBar'
import { supportsVision } from './aiHelpers'
import type { AiStreamPanelState } from './useAiStreamPanel'

export default function AiPanelHeader({ panel }: { panel: AiStreamPanelState }) {
  const {
    activeWorkspace, availableWorkspaces, setWorkspace, messages, selectedModel, localModels,
    providers, activeProviderId, handleSwitchProvider, handleModelChange, modelCaps,
    refreshModelCaps, setShowSavedChatsModal, setChatSearchQuery, handleNewChat,
    handleOpenMemoryPanel, showSettingsPanel, setShowSettingsPanel, workspaceFolder, workspaceFiles,
    workspaceIndexing, handleImportWorkspace, handleExportChat
  } = panel
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-4)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-2)',
        flexShrink: 0
      }}
    >
      {/* Row 0: Provider Selection (manage profiles in Settings → AI) */}
      {providers.length > 0 && (
        <div className="row-full">
          <span className="label-caps-fixed">
            Provider
          </span>
          <select
            value={activeProviderId}
            onChange={e => handleSwitchProvider(e.target.value)}
            title="Switch AI provider. Add/edit profiles in Settings → AI"
            className="select-sm"
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}{isLocalUrl(p.baseURL) ? ' (local)' : ' (cloud)'}</option>
            ))}
          </select>
        </div>
      )}

      {/* Row 1: Model Selection */}
      <div className="row-full">
        <span className="label-caps-fixed">
          Model
        </span>
        {(() => {
          const dropdownModels = Array.from(new Set([
            ...localModels,
            ...(selectedModel ? [selectedModel] : ['llama3'])
          ]))
          return (
            <select
              value={selectedModel}
              onChange={e => handleModelChange(e.target.value)}
              className="select-sm"
            >
              {dropdownModels.map(m => (
                <option key={m} value={m}>{m}{supportsVision(m) ? ' 👁' : ''}</option>
              ))}
              <option value="__CUSTOM_MODEL__">+ Use Custom Model...</option>
              <option value="__OPEN_COOKBOOK__">+ Get More Models (Cookbook)...</option>
            </select>
          )
        })()}
      </div>

      <ModelCapabilityBar caps={modelCaps} onRefresh={refreshModelCaps} />

      {/* Row 1b: Workspace / Context Selection. The board the AI reads & writes */}
      <div className="row-full">
        <span className="label-caps-fixed">
          Workspace
        </span>
        <select
          value={activeWorkspace}
          onChange={e => setWorkspace(e.target.value)}
          title="Which workspace the assistant reads from and creates items in"
          className="select-sm"
        >
          {(availableWorkspaces.length > 0 ? availableWorkspaces : ['default']).map(ctx => (
            <option key={ctx} value={ctx}>{ctx}</option>
          ))}
        </select>
      </div>

      {/* Row 2: Action Buttons */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        borderTop: '1px dashed var(--color-surface-offset)',
        paddingTop: 'var(--space-1.5)'
      }}>
        <span className="label-caps-sm">
          Actions
        </span>
        <div className="row-6px">
          <button
            onClick={handleImportWorkspace}
            disabled={workspaceIndexing}
            style={{
              background: workspaceFolder ? 'var(--color-secondary-muted)' : 'transparent',
              border: 'none',
              color: workspaceFolder ? 'var(--color-secondary)' : 'var(--color-text-muted)',
              cursor: workspaceIndexing ? 'default' : 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: 'var(--radius-sm)'
            }}
            onMouseEnter={e => { if (!workspaceFolder) e.currentTarget.style.color = 'var(--color-secondary)' }}
            onMouseLeave={e => { if (!workspaceFolder) e.currentTarget.style.color = 'var(--color-text-muted)' }}
            title={workspaceFolder ? `Workspace imported: ${workspaceFolder} (${workspaceFiles.length} files). Click to re-import` : 'Import a project folder for codebase context'}
          >
            {workspaceIndexing ? <RefreshCw size={13} className="animate-spin" /> : <FolderOpen size={13} />}
          </button>

          <button
            onClick={handleOpenMemoryPanel}
            className="icon-btn-md"
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            title="View AI Memories"
          >
            <Brain size={13} />
          </button>

          <button
            onClick={handleExportChat}
            disabled={messages.filter(m => m.role !== 'system').length === 0}
            style={{
              background: 'transparent',
              border: 'none',
              color: messages.filter(m => m.role !== 'system').length === 0 ? 'var(--color-text-faint)' : 'var(--color-text-muted)',
              cursor: messages.filter(m => m.role !== 'system').length === 0 ? 'default' : 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: 'var(--radius-sm)'
            }}
            onMouseEnter={e => { if (messages.filter(m => m.role !== 'system').length > 0) e.currentTarget.style.color = 'var(--color-secondary)' }}
            onMouseLeave={e => { if (messages.filter(m => m.role !== 'system').length > 0) e.currentTarget.style.color = 'var(--color-text-muted)' }}
            title="Export Chat as Markdown"
          >
            <FileDown size={13} />
          </button>

          <button
            onClick={() => setShowSettingsPanel(s => !s)}
            style={{
              background: showSettingsPanel ? 'var(--color-secondary-muted)' : 'transparent',
              border: 'none',
              color: showSettingsPanel ? 'var(--color-secondary)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: 'var(--radius-sm)'
            }}
            onMouseEnter={e => { if (!showSettingsPanel) e.currentTarget.style.color = 'var(--color-secondary)' }}
            onMouseLeave={e => { if (!showSettingsPanel) e.currentTarget.style.color = 'var(--color-text-muted)' }}
            title="AI Settings (Temperature, System Prompt)"
          >
            <Sliders size={13} />
          </button>

          <button
            onClick={() => { setChatSearchQuery(''); setShowSavedChatsModal(true) }}
            className="icon-btn-md"
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            title="Saved Chats (History)"
          >
            <MessageSquare size={13} />
          </button>

          <button
            onClick={handleNewChat}
            className="icon-btn-md"
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            title="New Chat"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
