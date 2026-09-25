/** images stored beside the db */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerMediaHandlers(): void {
  ipcMain.handle(IpcChannels.MEDIA_SAVE_FROM_BUFFER, async (_event, arrayBuffer: ArrayBuffer, extension: string) => {
    try {
      const { saveBufferToMedia } = await import('../mediaService')
      const buffer = Buffer.from(arrayBuffer)
      return saveBufferToMedia(buffer, extension)
    } catch (err) {
      console.error('IPC media:saveFromBuffer failed:', err)
      throw err
    }
  })

  ipcMain.handle(IpcChannels.MEDIA_SAVE_FILE_PATHS, async (_event, filePaths: string[]) => {
    try {
      const { saveFilesToMedia } = await import('../mediaService')
      return saveFilesToMedia(filePaths)
    } catch (err) {
      console.error('IPC media:saveFilePaths failed:', err)
      throw err
    }
  })

  ipcMain.handle(IpcChannels.MEDIA_SCAN_AND_PRUNE, async () => {
    try {
      const { scanAndPruneOrphanedMedia } = await import('../mediaService')
      return scanAndPruneOrphanedMedia()
    } catch (err) {
      console.error('IPC media:scanAndPrune failed:', err)
      throw err
    }
  })

  // the page is read and dropped, only its favicon is kept in media
  ipcMain.handle(IpcChannels.MEDIA_LINK_PREVIEW, async (_event, url: unknown) => {
    if (typeof url !== 'string') return null
    const { fetchLinkPreview } = await import('../linkPreview')
    return fetchLinkPreview(url)
  })

  ipcMain.handle(IpcChannels.MEDIA_GET_STORAGE_INFO, async () => {
    try {
      const { getStorageInfo } = await import('../mediaService')
      return getStorageInfo()
    } catch (err) {
      console.error('IPC media:getStorageInfo failed:', err)
      throw err
    }
  })

  ipcMain.handle(IpcChannels.MEDIA_SAVE_NAMED_BUFFER, async (_event, arrayBuffer: ArrayBuffer, filename: string) => {
    try {
      const { saveNamedBufferToMedia } = await import('../mediaService')
      const buffer = Buffer.from(arrayBuffer)
      return saveNamedBufferToMedia(buffer, filename)
    } catch (err) {
      console.error('IPC media:saveNamedBuffer failed:', err)
      throw err
    }
  })

  ipcMain.handle(IpcChannels.MEDIA_READ_BUFFER, async (_event, filename: string) => {
    try {
      const { readMediaBuffer } = await import('../mediaService')
      const buffer = readMediaBuffer(filename)
      if (!buffer) return null
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    } catch (err) {
      console.error('IPC media:readBuffer failed:', err)
      return null
    }
  })
}
