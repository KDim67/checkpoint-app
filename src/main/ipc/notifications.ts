/** raising notifications, and the policy around them */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerNotificationsHandlers(): void {
  ipcMain.handle(IpcChannels.NOTIFY_SEND, async (_event, input: unknown) => {
    const { notify } = await import('../notificationService')
    return notify(input as Parameters<typeof notify>[0])
  })

  ipcMain.handle(IpcChannels.NOTIFY_GET_POLICY, async () => {
    const { getNotificationPolicy } = await import('../notificationService')
    return getNotificationPolicy()
  })

  ipcMain.handle(IpcChannels.NOTIFY_SET_POLICY, async (_event, policy: unknown) => {
    const { POLICY_SETTING_KEY } = await import('../notificationService')
    const { normalizePolicy } = await import('../../shared/notificationPolicy')
    const { setSetting } = await import('../db')
    const next = normalizePolicy(policy)
    setSetting(POLICY_SETTING_KEY, next)
    return next
  })
}
