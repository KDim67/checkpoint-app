/** MCP server, and undoing an agent's changes */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { sendToWindow } from '../windows'

export function registerMcpHandlers(): void {
  ipcMain.handle(IpcChannels.MCP_ACTIVITY_LIST, async (_event, limit?: number) => {
    const { listMcpActivity } = await import('../mcpActivity')
    return listMcpActivity(typeof limit === 'number' ? limit : 50)
  })

  ipcMain.handle(IpcChannels.MCP_ACTIVITY_UNDO, async (_event, id: string) => {
    const { undoMcpActivity } = await import('../mcpActivity')
    const result = undoMcpActivity(id)
    if (result.ok) {
      // otherwise the open board only shows the reversal after a refresh
      sendToWindow(IpcChannels.MCP_DATA_CHANGED)
    }
    return result
  })

  ipcMain.handle(IpcChannels.MCP_TOGGLE, async (_event, active: boolean, port: number) => {
    const { toggleMcpServer, setMcpDataChangedHandler, MCP_DEFAULT_PORT: fallback } = await import('../mcpServer')
    const { setSetting } = await import('../db')

    setMcpDataChangedHandler(active
      ? () => sendToWindow(IpcChannels.MCP_DATA_CHANGED)
      : null)

    // let a port clash reach Settings, not a toggle that looks on with nothing listening
    const actualPort = await toggleMcpServer(active, port || fallback)
    setSetting('feature_mcp', active ? 'true' : 'false')
    if (active && actualPort) setSetting('mcp_port', String(actualPort))
    return actualPort
  })

  ipcMain.handle(IpcChannels.MCP_GET_STATUS, async () => {
    const { getMcpPort, getOrCreateMcpToken, MCP_DEFAULT_PORT: fallback } = await import('../mcpServer')
    const { getSetting } = await import('../db')
    return {
      running: getMcpPort() !== null,
      port: getMcpPort() ?? (parseInt(getSetting<string>('mcp_port', String(fallback)), 10) || fallback),
      enabled: getSetting<string>('feature_mcp', 'false') === 'true',
      token: getOrCreateMcpToken()
    }
  })

  ipcMain.handle(IpcChannels.MCP_REGENERATE_TOKEN, async () => {
    const { regenerateMcpToken } = await import('../mcpServer')
    // token is read per request, existing clients just start getting 401s
    return regenerateMcpToken()
  })
}
