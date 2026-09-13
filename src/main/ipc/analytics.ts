/** passive activity tracking and its totals */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { handleSafe } from './handleSafe'
import { z } from 'zod'
import { getActivityStats } from '../db'

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


  ipcMain.handle(IpcChannels.TRACKER_GET_STATS, (_event, context: unknown, timeStart: unknown, timeEnd: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().nullable().parse(context)
      const parsedStart = z.number().parse(timeStart)
      const parsedEnd = z.number().parse(timeEnd)
      return getActivityStats(parsedContext, parsedStart, parsedEnd)
    })
  })
}
