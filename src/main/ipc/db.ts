/** Reading and writing cards, tasks, tags and relations. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { handleSafe } from './handleSafe'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import {
  bulkDeleteItems,
  createFocusSession,
  createItem,
  createRelation,
  createTag,
  deleteItem,
  deleteRelation,
  deleteSetting,
  deleteTag,
  getAllTags,
  getContextSlugs,
  getFocusSessions,
  getItemsPaginated,
  getRelations,
  getSetting,
  queryTasks,
  rebalancePositions,
  searchItems,
  setSetting,
  updateItem,
  updateTag
} from '../db'
import {
  BulkUpdateSchema,
  CreateFocusSessionSchema,
  CreateItemSchema,
  CreateTagSchema,
  RelationTypeSchema,
  SearchQuerySchema,
  TaskQueryParamsSchema,
  UpdateItemSchema
} from '../validation'

export function registerDbHandlers(db: Database.Database): void {
  ipcMain.handle(IpcChannels.DB_GET_ITEMS, (_event, context: unknown, type: unknown, page: unknown, pageSize: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().parse(context)
      const parsedType = z.string().parse(type)
      const parsedPage = z.number().int().nonnegative().parse(page)
      const parsedPageSize = z.number().int().positive().parse(pageSize)
      return getItemsPaginated(parsedContext, parsedType, parsedPage, parsedPageSize)
    })
  })

  ipcMain.handle(IpcChannels.DB_CREATE_ITEM, (_event, payload: unknown, tagIds: unknown) => {
    return handleSafe(() => {
      const parsedPayload = CreateItemSchema.parse(payload)
      const parsedTagIds = z.array(z.string()).default([]).parse(tagIds)
      return createItem(db, parsedPayload, parsedTagIds)
    })
  })

  ipcMain.handle(IpcChannels.DB_UPDATE_ITEM, (_event, id: unknown, patch: unknown, tagIds?: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      const parsedPatch = UpdateItemSchema.parse(patch)
      const parsedTagIds = tagIds !== undefined ? z.array(z.string()).parse(tagIds) : undefined
      return updateItem(db, parsedId, parsedPatch, parsedTagIds)
    })
  })

  ipcMain.handle(IpcChannels.DB_DELETE_ITEM, (_event, id: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      return { context: deleteItem(parsedId) }
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_TAGS, () => {
    return handleSafe(() => getAllTags())
  })

  ipcMain.handle(IpcChannels.DB_CREATE_TAG, (_event, payload: unknown) => {
    return handleSafe(() => {
      const parsedPayload = CreateTagSchema.parse(payload)
      return createTag(parsedPayload)
    })
  })

  ipcMain.handle(IpcChannels.DB_UPDATE_TAG, (_event, id: unknown, payload: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      const parsedPayload = CreateTagSchema.partial().parse(payload)
      return updateTag(parsedId, parsedPayload)
    })
  })

  ipcMain.handle(IpcChannels.DB_DELETE_TAG, (_event, id: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      deleteTag(parsedId)
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_SETTING, (_event, key: unknown) => {
    return handleSafe(() => {
      const parsedKey = z.string().parse(key)
      return getSetting(parsedKey, null)
    })
  })

  ipcMain.handle(IpcChannels.DB_SET_SETTING, (_event, key: unknown, value: unknown) => {
    return handleSafe(() => {
      const parsedKey = z.string().parse(key)
      setSetting(parsedKey, value)
    })
  })

  ipcMain.handle(IpcChannels.DB_DELETE_SETTING, (_event, key: unknown) => {
    return handleSafe(() => {
      const parsedKey = z.string().parse(key)
      deleteSetting(parsedKey)
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_RELATIONS, (_event, itemId: unknown) => {
    return handleSafe(() => {
      const parsedItemId = z.string().parse(itemId)
      return getRelations(parsedItemId)
    })
  })

  ipcMain.handle(IpcChannels.DB_CREATE_RELATION, (_event, fromId: unknown, toId: unknown, type: unknown) => {
    return handleSafe(() => {
      const parsedFromId = z.string().parse(fromId)
      const parsedToId = z.string().parse(toId)
      const parsedType = RelationTypeSchema.parse(type)
      return createRelation(parsedFromId, parsedToId, parsedType)
    })
  })

  ipcMain.handle(IpcChannels.DB_DELETE_RELATION, (_event, id: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      deleteRelation(parsedId)
    })
  })

  ipcMain.handle(IpcChannels.DB_SEARCH_ITEMS, (_event, query: unknown) => {
    return handleSafe(() => {
      const parsedQuery = SearchQuerySchema.parse(query)
      return searchItems(parsedQuery)
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_CONTEXTS, () => {
    return handleSafe(() => getContextSlugs())
  })

  ipcMain.handle(IpcChannels.DB_BULK_UPDATE_ITEMS, (_event, payload: unknown) => {
    return handleSafe(() => {
      const parsedPayload = BulkUpdateSchema.parse(payload)
      const now = Date.now()

      // Build the SET clause once from whichever fields were actually provided,
      // so bulk status/priority/context updates all persist (not just status).
      const setFields: string[] = []
      const baseParams: Record<string, unknown> = { updated_at: now }
      if (parsedPayload.patch.status !== undefined) {
        setFields.push('status = @status')
        baseParams.status = parsedPayload.patch.status
      }
      if (parsedPayload.patch.priority !== undefined) {
        setFields.push('priority = @priority')
        baseParams.priority = parsedPayload.patch.priority
      }
      if (parsedPayload.patch.context !== undefined) {
        setFields.push('context = @context')
        baseParams.context = parsedPayload.patch.context
      }

      if (setFields.length > 0) {
        setFields.push('updated_at = @updated_at')
        const stmtBulkUpdate = db.prepare(
          `UPDATE items SET ${setFields.join(', ')} WHERE id = @id`
        )
        db.transaction(() => {
          for (const id of parsedPayload.ids) {
            stmtBulkUpdate.run({ ...baseParams, id })
          }
        })()
      }

      return { updated: parsedPayload.ids.length }
    })
  })

  ipcMain.handle(IpcChannels.DB_BULK_DELETE_ITEMS, (_event, ids: unknown) => {
    return handleSafe(() => {
      const parsedIds = z.array(z.string()).parse(ids)
      return { deleted: bulkDeleteItems(db, parsedIds) }
    })
  })

  ipcMain.handle(IpcChannels.DB_REBALANCE_POSITIONS, (_event, context: unknown, status: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().parse(context)
      const parsedStatus = z.string().parse(status)
      rebalancePositions(db, parsedContext, parsedStatus)
    })
  })

  ipcMain.handle(IpcChannels.DB_QUERY_TASKS, (_event, context: unknown, params: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().parse(context)
      const parsedParams = TaskQueryParamsSchema.parse(params)
      return queryTasks(db, parsedContext, parsedParams)
    })
  })

  ipcMain.handle(IpcChannels.DB_CREATE_FOCUS_SESSION, (_event, payload: unknown) => {
    return handleSafe(() => {
      const parsedPayload = CreateFocusSessionSchema.parse(payload)
      return createFocusSession(parsedPayload)
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_FOCUS_SESSIONS, (_event, context: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().parse(context)
      return getFocusSessions(parsedContext)
    })
  })
}
