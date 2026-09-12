/** Hardware profiling and the local Ollama runtime. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { getMainWindow } from '../windows'

export function registerCookbookHandlers(): void {
  ipcMain.handle(IpcChannels.HARDWARE_GET_SPECS, async () => {
    const { getHardwareSpecs } = await import('../profiler')
    return getHardwareSpecs()
  })

  ipcMain.handle(IpcChannels.OLLAMA_CHECK_INSTALLED, async () => {
    const { checkOllama } = await import('../ollamaManager')
    return checkOllama()
  })

  ipcMain.handle(IpcChannels.OLLAMA_LIST_LOCAL, async () => {
    const { listLocalModels } = await import('../ollamaManager')
    return listLocalModels()
  })

  ipcMain.handle(IpcChannels.OLLAMA_PULL, async (_event, modelTag: string) => {
    const win = getMainWindow()
    if (!win) return
    const { pullModel } = await import('../ollamaManager')
    // Run in background and stream progress via push IPC
    pullModel(modelTag, win).catch(console.error)
  })

  ipcMain.handle(IpcChannels.OLLAMA_STOP, async () => {
    const { stopPull } = await import('../ollamaManager')
    stopPull()
  })

  ipcMain.handle(IpcChannels.OLLAMA_DELETE, async (_event, modelTag: string) => {
    const { deleteModel } = await import('../ollamaManager')
    return deleteModel(modelTag)
  })
}
