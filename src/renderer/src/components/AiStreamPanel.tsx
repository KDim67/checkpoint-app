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
      <AiPanelHeader panel={panel} />

      {showSettingsPanel && <SettingsPanel temperature={temperature} setTemperature={setTemperature} maxTokens={maxTokens} setMaxTokens={setMaxTokens} systemPromptOverride={systemPromptOverride} setSystemPromptOverride={setSystemPromptOverride} />}

      <AiChatHistory panel={panel} />

      <AiInputDock panel={panel} />

      {showCustomActionsModal && <CustomActionsModal actions={quickActions} />}

      {showCookbookModal && <CookbookModal models={modelConfig} />}

      {showSavedChatsModal && <SavedChatsModal chats={chatHistory} handleNewChat={handleNewChat} handleLoadChat={handleLoadChat} handleDeleteChat={handleDeleteChat} />}
      {showMemoryPanel && <MemoryVaultModal vault={vault} activeWorkspace={activeWorkspace} />}

      {revertConfirmData && <RevertConfirmModal revertConfirmData={revertConfirmData} setRevertConfirmData={setRevertConfirmData} revertAICreatedEntities={revertAICreatedEntities} setMessages={setMessages} />}

      {showCustomModelPrompt && <CustomModelPromptModal models={modelConfig} />}
    </div>
  )
}
