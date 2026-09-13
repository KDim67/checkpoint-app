import MemoryVaultModal from './ai/MemoryVaultModal'
import CustomActionsModal from './ai/CustomActionsModal'
import SavedChatsModal from './ai/SavedChatsModal'
import SettingsPanel from './ai/SettingsPanel'
import CookbookModal from './ai/CookbookModal'
import RevertConfirmModal from './ai/RevertConfirmModal'
import CustomModelPromptModal from './ai/CustomModelPromptModal'
import { useAiStreamPanel } from './ai/useAiStreamPanel'
import AiPanelHeader from './ai/AiPanelHeader'
import AiChatHistory from './ai/AiChatHistory'
import AiInputDock from './ai/AiInputDock'

export default function AiStreamPanel() {
  const panel = useAiStreamPanel()
  const {
    activeWorkspace, setMessages, modelConfig, temperature, setTemperature, maxTokens, setMaxTokens,
    showCookbookModal, showCustomModelPrompt, chatHistory, showSavedChatsModal, revertConfirmData,
    setRevertConfirmData, handleNewChat, handleLoadChat, handleDeleteChat, vault, showMemoryPanel,
    showSettingsPanel, systemPromptOverride, setSystemPromptOverride, quickActions,
    showCustomActionsModal, revertAICreatedEntities
  } = panel

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}
    >
      {/* Selector Header controls */}
      <AiPanelHeader panel={panel} />

      {/* Inline Settings Panel */}
      {showSettingsPanel && <SettingsPanel temperature={temperature} setTemperature={setTemperature} maxTokens={maxTokens} setMaxTokens={setMaxTokens} systemPromptOverride={systemPromptOverride} setSystemPromptOverride={setSystemPromptOverride} />}

      {/* Main chat history list */}
      <AiChatHistory panel={panel} />

      {/* Input panel at bottom */}
      <AiInputDock panel={panel} />

      {/* Custom Quick Actions Manager Modal */}
      {showCustomActionsModal && <CustomActionsModal actions={quickActions} />}

      {/* Cookbook Model Manager Popup Modal */}
      {showCookbookModal && <CookbookModal models={modelConfig} />}

      {/* Saved Chats Drawer Modal */}
      {showSavedChatsModal && <SavedChatsModal chats={chatHistory} handleNewChat={handleNewChat} handleLoadChat={handleLoadChat} handleDeleteChat={handleDeleteChat} />}
      {/* Memory Vault Modal */}
      {showMemoryPanel && <MemoryVaultModal vault={vault} activeWorkspace={activeWorkspace} />}

      {/* Styled Revert Confirmation Modal */}
      {revertConfirmData && <RevertConfirmModal revertConfirmData={revertConfirmData} setRevertConfirmData={setRevertConfirmData} revertAICreatedEntities={revertAICreatedEntities} setMessages={setMessages} />}

      {/* Custom Model Prompt Modal */}
      {showCustomModelPrompt && <CustomModelPromptModal models={modelConfig} />}
    </div>
  )
}
