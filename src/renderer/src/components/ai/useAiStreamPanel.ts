import { useAiChat } from './useAiChat'
import { useAiSend } from './useAiSend'
import { useAiPanelExtras } from './useAiPanelExtras'
export type { SubmitOptions } from './useAiSend'

/**
 * The assistant panel apart from drawing it: the conversation, the stream, the
 * board edits a reply makes, and the hooks for chats, actions, models and memory.
 * The header, the history and the input take its return as one prop.
 */
export function useAiStreamPanel() {
  const aiChat = useAiChat()
  const aiSend = useAiSend(aiChat)
  const aiExtras = useAiPanelExtras(aiChat)
  const {
    selectItem, activeWorkspace, availableWorkspaces, setWorkspace, messages, setMessages,
    inputValue, setInputValue, isStreaming, streamingText, contextItem, setContextItem, modelConfig,
    selectedModel, localModels, temperature, setTemperature, maxTokens, setMaxTokens, providers,
    activeProviderId, showCookbookModal, showCustomModelPrompt, handleSwitchProvider,
    handleModelChange, modelCaps, refreshModelCaps, chatHistory, showSavedChatsModal,
    setShowSavedChatsModal, setChatSearchQuery, revertConfirmData, setRevertConfirmData,
    handleNewChat, handleLoadChat, handleDeleteChat, scrollContainerRef, isAtBottomRef,
    isWaitingForFirstChunk, recalledMemCount, waitingLabel, vault, showMemoryPanel,
    setShowMemoryPanel, handleOpenMemoryPanel, showSettingsPanel, setShowSettingsPanel,
    systemPromptOverride, setSystemPromptOverride, activeSkillId, workspaceFolder, workspaceFiles,
    workspaceIndexing, handleImportWorkspace, handleClearWorkspace, quickActions, customActions,
    showCustomActionsModal, setShowCustomActionsModal, copiedMsgIndex, scrollToBottom,
    showJumpToLatest, setShowJumpToLatest, handleScroll
  } = aiChat
  const {
    handleSelectSkill, revertAICreatedEntities, handleRevert, handleRewrite, handleResend,
    handleSubmitWithText, handleSubmit, handleAbort
  } = aiSend
  const {
    handleExportChat, handleCopyMessage, tokenUsage
  } = aiExtras

  return {
    selectItem,
    activeWorkspace,
    availableWorkspaces,
    setWorkspace,
    messages,
    setMessages,
    inputValue,
    setInputValue,
    isStreaming,
    streamingText,
    contextItem,
    setContextItem,
    modelConfig,
    selectedModel,
    localModels,
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    providers,
    activeProviderId,
    showCookbookModal,
    showCustomModelPrompt,
    handleSwitchProvider,
    handleModelChange,
    modelCaps,
    refreshModelCaps,
    chatHistory,
    showSavedChatsModal,
    setShowSavedChatsModal,
    setChatSearchQuery,
    revertConfirmData,
    setRevertConfirmData,
    handleNewChat,
    handleLoadChat,
    handleDeleteChat,
    scrollContainerRef,
    isAtBottomRef,
    isWaitingForFirstChunk,
    recalledMemCount,
    waitingLabel,
    vault,
    showMemoryPanel,
    setShowMemoryPanel,
    handleOpenMemoryPanel,
    showSettingsPanel,
    setShowSettingsPanel,
    systemPromptOverride,
    setSystemPromptOverride,
    activeSkillId,
    workspaceFolder,
    workspaceFiles,
    workspaceIndexing,
    handleImportWorkspace,
    handleClearWorkspace,
    quickActions,
    customActions,
    showCustomActionsModal,
    setShowCustomActionsModal,
    copiedMsgIndex,
    scrollToBottom,
    showJumpToLatest,
    setShowJumpToLatest,
    handleScroll,
    handleSelectSkill,
    revertAICreatedEntities,
    handleRevert,
    handleRewrite,
    handleResend,
    handleSubmitWithText,
    handleSubmit,
    handleAbort,
    handleExportChat,
    handleCopyMessage,
    tokenUsage
  }
}

export type AiStreamPanelState = ReturnType<typeof useAiStreamPanel>
