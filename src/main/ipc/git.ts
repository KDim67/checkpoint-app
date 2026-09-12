/** Reading a repository the user points at. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerGitHandlers(): void {
  ipcMain.handle(IpcChannels.GIT_CHECK, async (_event, repoPath: string) => {
    const { checkRepo } = await import('../gitService')
    return checkRepo(repoPath)
  })

  ipcMain.handle(IpcChannels.GIT_STATUS, async (_event, repoPath: string) => {
    const { getGitStatus } = await import('../gitService')
    return getGitStatus(repoPath)
  })

  ipcMain.handle(IpcChannels.GIT_LOG, async (_event, repoPath: string) => {
    const { getGitLog } = await import('../gitService')
    return getGitLog(repoPath)
  })
}
