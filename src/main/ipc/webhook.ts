/** local HTTP gateway for external automation */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerWebhookHandlers(): void {
  ipcMain.handle(IpcChannels.WEBHOOK_TOGGLE, async (_event, active: boolean, port: number) => {
    const { toggleWebhookGateway } = await import('../webhookGateway')
    const actualPort = await toggleWebhookGateway(active, port)
    if (active && actualPort) {
      const { setSetting } = await import('../db')
      setSetting('webhook_port', String(actualPort))
    }
    return actualPort
  })
}
