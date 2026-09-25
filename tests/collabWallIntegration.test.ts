// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeCollabMessage,
  type BoardBaselineMessage,
  type WallDocMessage
} from '../src/shared/collabProtocol'
import {
  normalizeWallDoc,
  normalizeWallIndex,
  type WallDoc,
  type WallIndex
} from '../src/shared/wallModel'
import {
  flushWallDoc,
  WALL_DOC_EVENT
} from '../src/renderer/src/lib/wallDoc'

const mockSettings = new Map<string, unknown>()

vi.mock('../src/renderer/src/data/settings', () => ({
  getSetting: vi.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, val: unknown) => {
    mockSettings.set(key, val)
  }),
  deleteSetting: vi.fn(async (key: string) => {
    mockSettings.delete(key)
  })
}))

describe('Collab Wall Sync Integration', () => {
  beforeEach(() => {
    mockSettings.clear()
    vi.clearAllMocks()
  })

  const sampleDoc: WallDoc = normalizeWallDoc({
    version: 1,
    camera: { x: 0, y: 0, zoom: 1 },
    items: [
      {
        id: 'n1',
        kind: 'note',
        x: 100,
        y: 100,
        width: 150,
        height: 150,
        text: 'Host note',
        color: '#feff9c'
      }
    ]
  })

  const sampleIndex: WallIndex = normalizeWallIndex({
    activeId: 'default',
    walls: [{ id: 'default', name: 'Main Wall' }]
  })

  it('preserves wall documents in baseline across serialization/normalization', () => {
    const rawBaseline: BoardBaselineMessage = {
      type: 'board-baseline',
      context: 'workspace-collab',
      items: [],
      tags: [],
      itemTags: [],
      relations: [],
      mode: 'collaborative',
      walls: {
        index: sampleIndex,
        docs: {
          default: sampleDoc
        }
      }
    }

    const wirePayload = JSON.parse(JSON.stringify(rawBaseline))
    const normalized = normalizeCollabMessage(wirePayload)

    expect(normalized).not.toBeNull()
    expect(normalized?.type).toBe('board-baseline')
    if (normalized?.type === 'board-baseline') {
      expect(normalized.walls).toBeDefined()
      expect(normalized.walls?.index.activeId).toBe('default')
      expect(normalized.walls?.docs['default'].items).toHaveLength(1)
      expect(normalized.walls?.docs['default'].items[0].text).toBe('Host note')
    }
  })

  it('triggers local wall-doc-written event when user edits wall doc with context and wallId', async () => {
    const onWallWritten = vi.fn()
    window.addEventListener(WALL_DOC_EVENT, onWallWritten)

    const updatedDoc: WallDoc = {
      ...sampleDoc,
      items: [
        ...sampleDoc.items,
        {
          id: 'n2',
          kind: 'shape',
          shape: 'diamond',
          x: 200,
          y: 200,
          width: 80,
          height: 80,
          z: 1
        }
      ]
    }

    await flushWallDoc('wall_workspace-collab', updatedDoc, {
      context: 'workspace-collab',
      wallId: 'default'
    })

    expect(onWallWritten).toHaveBeenCalledTimes(1)
    const event = onWallWritten.mock.calls[0][0] as CustomEvent
    expect(event.detail.context).toBe('workspace-collab')
    expect(event.detail.wallId).toBe('default')
    expect(event.detail.doc.items).toHaveLength(2)

    window.removeEventListener(WALL_DOC_EVENT, onWallWritten)
  })

  it('handles remote wall-doc-sync without echoing', async () => {
    const onWallRefresh = vi.fn()
    const onWallWritten = vi.fn()
    window.addEventListener('wall-refresh', onWallRefresh)
    window.addEventListener(WALL_DOC_EVENT, onWallWritten)

    const remoteMsg: WallDocMessage = {
      type: 'wall-doc-sync',
      context: 'workspace-collab',
      wallId: 'default',
      doc: sampleDoc
    }

    // Applying remote message with skipBroadcast
    await flushWallDoc('wall_workspace-collab', remoteMsg.doc, {
      context: 'workspace-collab',
      wallId: 'default',
      skipBroadcast: true
    })
    window.dispatchEvent(new CustomEvent('wall-refresh', { detail: { wallId: 'default', doc: remoteMsg.doc } }))

    expect(onWallRefresh).toHaveBeenCalledTimes(1)
    expect(onWallWritten).not.toHaveBeenCalled()

    window.removeEventListener('wall-refresh', onWallRefresh)
    window.removeEventListener(WALL_DOC_EVENT, onWallWritten)
  })
})
