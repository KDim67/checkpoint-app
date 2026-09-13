/** texture and sprite tools that write files */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { errorMessage } from '../../shared/errors'
import { batchRenameFiles, loadTextureFile, saveLutTexture, savePbrMaps, saveSeamlessTexture, saveSlicedSprites, saveSpriteAtlas, saveUpscaledTexture, selectFolder, selectTextureFile } from '../gamedevService'

export function registerGamedevHandlers(): void {
  ipcMain.handle(IpcChannels.GAMEDEV_BATCH_RENAME, async (_event, files: Array<{ oldPath: string; newPath: string }>) => {
    try {
      return await batchRenameFiles(files)
    } catch (err) {
      console.error('IPC batchRenameFiles failed:', err)
      return { success: false, renamedCount: 0, errors: [{ oldPath: '', newPath: '', error: errorMessage(err) }] }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SELECT_TEXTURE, async () => {
    try {
      return await selectTextureFile()
    } catch (err) {
      console.error('IPC selectTextureFile failed:', err)
      return null
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_LOAD_TEXTURE, async (_event, path: string) => {
    try {
      return await loadTextureFile(path)
    } catch (err) {
      console.error('IPC loadTextureFile failed:', err)
      return null
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_MAPS, async (
    _event,
    params: { albedoPath: string; maps: { normal?: string; height?: string; roughness?: string; ao?: string } }
  ) => {
    try {
      return await savePbrMaps(params.albedoPath, params.maps)
    } catch (err) {
      console.error('IPC savePbrMaps failed:', err)
      return { success: false, writtenFiles: [], error: errorMessage(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_SEAMLESS, async (_event, params: { originalPath: string; dataUrl: string }) => {
    try {
      return await saveSeamlessTexture(params.originalPath, params.dataUrl)
    } catch (err) {
      console.error('IPC saveSeamlessTexture failed:', err)
      return { success: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SELECT_SPRITE_FOLDER, async () => {
    try {
      return await selectFolder()
    } catch (err) {
      console.error('IPC selectFolder failed:', err)
      return null
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_SPRITE_ATLAS, async (_event, params: { folderPath: string; atlasDataUrl: string; atlasJson: string }) => {
    try {
      return await saveSpriteAtlas(params.folderPath, params.atlasDataUrl, params.atlasJson)
    } catch (err) {
      console.error('IPC saveSpriteAtlas failed:', err)
      return { success: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_SLICES, async (_event, params: { originalPath: string; files: Array<{ index: number; dataUrl: string }> }) => {
    try {
      return await saveSlicedSprites(params.originalPath, params.files)
    } catch (err) {
      console.error('IPC saveSlices failed:', err)
      return { success: false, count: 0, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_LUT, async (_event, params: { originalPath: string; dataUrl: string }) => {
    try {
      return await saveLutTexture(params.originalPath, params.dataUrl)
    } catch (err) {
      console.error('IPC saveLut failed:', err)
      return { success: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_UPSCALED, async (_event, params: { originalPath: string; suffix: string; dataUrl: string }) => {
    try {
      return await saveUpscaledTexture(params.originalPath, params.suffix, params.dataUrl)
    } catch (err) {
      console.error('IPC saveUpscaled failed:', err)
      return { success: false, error: errorMessage(err) }
    }
  })
}
