import { describe, it, expect } from 'vitest'
import { normalizeCollabMessage } from '../src/shared/collabProtocol'
import { normalizeWallDoc, normalizeWallIndex, type WallDoc, type WallIndex } from '../src/shared/wallModel'

describe('collabProtocol Wall Sync', () => {
  const sampleDoc: WallDoc = normalizeWallDoc({
    version: 1,
    camera: { x: 100, y: 200, zoom: 1 },
    items: [
      {
        id: 'n1',
        kind: 'note',
        x: 50,
        y: 60,
        width: 160,
        height: 160,
        text: 'Collaborative note',
        color: '#feff9c',
        font: 'handwriting'
      }
    ]
  })

  const sampleIndex: WallIndex = normalizeWallIndex({
    activeId: 'wall-2',
    walls: [
      { id: 'default', name: 'Main Wall' },
      { id: 'wall-2', name: 'Brainstorm' }
    ]
  })

  describe('wall-doc-sync', () => {
    it('normalizes a valid wall-doc-sync message', () => {
      const msg = {
        type: 'wall-doc-sync',
        context: 'workspace-a',
        wallId: 'default',
        doc: sampleDoc
      }
      const res = normalizeCollabMessage(msg)
      expect(res).toEqual({
        type: 'wall-doc-sync',
        context: 'workspace-a',
        wallId: 'default',
        doc: sampleDoc
      })
    })

    it('refuses a wall-doc-sync with missing or invalid context or wallId', () => {
      expect(normalizeCollabMessage({ type: 'wall-doc-sync', context: '', wallId: 'w1', doc: sampleDoc })).toBeNull()
      expect(normalizeCollabMessage({ type: 'wall-doc-sync', context: 'ws', wallId: '', doc: sampleDoc })).toBeNull()
      expect(normalizeCollabMessage({ type: 'wall-doc-sync', context: null, wallId: 'w1', doc: sampleDoc })).toBeNull()
    })

    it('normalizes the doc even if partial or dirty', () => {
      const msg = {
        type: 'wall-doc-sync',
        context: 'ws',
        wallId: 'w1',
        doc: { items: [{ id: 'item-x', kind: 'shape', shape: 'diamond' }] }
      }
      const res = normalizeCollabMessage(msg)
      expect(res).not.toBeNull()
      expect(res?.type).toBe('wall-doc-sync')
      if (res?.type === 'wall-doc-sync') {
        expect(res.doc.items).toHaveLength(1)
        expect(res.doc.items[0].id).toBe('item-x')
        expect(res.doc.items[0].kind).toBe('shape')
      }
    })
  })

  describe('wall-index-sync', () => {
    it('normalizes a valid wall-index-sync message', () => {
      const msg = {
        type: 'wall-index-sync',
        context: 'workspace-b',
        index: sampleIndex
      }
      const res = normalizeCollabMessage(msg)
      expect(res).toEqual({
        type: 'wall-index-sync',
        context: 'workspace-b',
        index: sampleIndex
      })
    })

    it('refuses wall-index-sync with missing context', () => {
      expect(normalizeCollabMessage({ type: 'wall-index-sync', context: '', index: sampleIndex })).toBeNull()
      expect(normalizeCollabMessage({ type: 'wall-index-sync', context: null, index: sampleIndex })).toBeNull()
    })
  })

  describe('board-baseline with walls', () => {
    it('includes normalized walls in baseline when present', () => {
      const msg = {
        type: 'board-baseline',
        context: 'my-workspace',
        items: [],
        tags: [],
        itemTags: [],
        relations: [],
        mode: 'collaborative',
        walls: {
          index: sampleIndex,
          docs: {
            'default': sampleDoc
          }
        }
      }
      const res = normalizeCollabMessage(msg)
      expect(res).not.toBeNull()
      expect(res?.type).toBe('board-baseline')
      if (res?.type === 'board-baseline') {
        expect(res.walls).toBeDefined()
        expect(res.walls?.index).toEqual(sampleIndex)
        expect(res.walls?.docs['default']).toEqual(sampleDoc)
      }
    })

    it('leaves walls undefined when not in baseline', () => {
      const msg = {
        type: 'board-baseline',
        context: 'my-workspace',
        items: [],
        tags: [],
        itemTags: [],
        relations: [],
        mode: 'collaborative'
      }
      const res = normalizeCollabMessage(msg)
      expect(res).not.toBeNull()
      if (res?.type === 'board-baseline') {
        expect(res.walls).toBeUndefined()
      }
    })
  })

  describe('peer-cursor', () => {
    it('normalizes a valid peer-cursor message', () => {
      const msg = {
        type: 'peer-cursor',
        context: 'ws-1',
        wallId: 'default',
        peerId: 'peer-abc',
        x: 250,
        y: 400,
        name: 'Dimitris',
        color: '#f43f5e'
      }
      const res = normalizeCollabMessage(msg)
      expect(res).toEqual({
        type: 'peer-cursor',
        context: 'ws-1',
        wallId: 'default',
        peerId: 'peer-abc',
        x: 250,
        y: 400,
        name: 'Dimitris',
        color: '#f43f5e'
      })
    })

    it('refuses peer-cursor with non-number coordinates or missing ids', () => {
      expect(normalizeCollabMessage({ type: 'peer-cursor', context: 'ws', wallId: 'w', peerId: 'p', x: NaN, y: 10 })).toBeNull()
      expect(normalizeCollabMessage({ type: 'peer-cursor', context: '', wallId: 'w', peerId: 'p', x: 10, y: 10 })).toBeNull()
      expect(normalizeCollabMessage({ type: 'peer-cursor', context: 'ws', wallId: 'w', peerId: '', x: 10, y: 10 })).toBeNull()
    })
  })

  describe('peer-selection', () => {
    it('normalizes a valid peer-selection message', () => {
      const msg = {
        type: 'peer-selection',
        context: 'ws-1',
        wallId: 'default',
        peerId: 'peer-abc',
        selectedIds: ['n1', 'n2'],
        name: 'Dimitris',
        color: '#f43f5e'
      }
      const res = normalizeCollabMessage(msg)
      expect(res).toEqual({
        type: 'peer-selection',
        context: 'ws-1',
        wallId: 'default',
        peerId: 'peer-abc',
        selectedIds: ['n1', 'n2'],
        name: 'Dimitris',
        color: '#f43f5e'
      })
    })

    it('refuses peer-selection with missing context or peerId', () => {
      expect(normalizeCollabMessage({ type: 'peer-selection', context: '', wallId: 'w', peerId: 'p', selectedIds: [] })).toBeNull()
      expect(normalizeCollabMessage({ type: 'peer-selection', context: 'ws', wallId: 'w', peerId: '', selectedIds: [] })).toBeNull()
    })
  })
})
