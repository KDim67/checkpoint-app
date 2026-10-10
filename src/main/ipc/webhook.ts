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

  // shown on purpose: you paste it into whatever calls the gateway
  ipcMain.handle(IpcChannels.WEBHOOK_GET_TOKEN, async () => {
    const { getSetting } = await import('../db')
    const { WEBHOOK_TOKEN_KEY } = await import('../webhookAuth')
    const token = getSetting<unknown>(WEBHOOK_TOKEN_KEY, '')
    return typeof token === 'string' ? token : ''
  })
}
