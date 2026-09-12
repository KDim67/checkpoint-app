/** Passive activity tracking and what it adds up to. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerAnalyticsHandlers(): void {
  ipcMain.handle(IpcChannels.ANALYTICS_GET_DATA, async (_event, context?: string | null) => {
    const { getAnalyticsData } = await import('../analyticsService')
    return getAnalyticsData(context ?? null)
  })

  ipcMain.handle(IpcChannels.TRACKER_TOGGLE, async (_event, active: boolean) => {
    const { toggleTracker } = await import('../tracker')
    toggleTracker(active)
  })

  ipcMain.handle(IpcChannels.TRACKER_GET_STATE, async () => {
    const { getTrackerState } = await import('../tracker')
    return getTrackerState()
  })
}
