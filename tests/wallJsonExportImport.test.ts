import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  buildWallJsonExport,
  extractWallExportMeta,
  normalizeWallDoc,
  createWallItem,
  type WallDoc,
  type WallItem
} from '../src/shared/wallModel'
import { placeClip } from '../src/shared/wallClipboard'

describe('wallJsonExportImport', () => {
  const itemA: WallItem = createWallItem('note', { x: 100, y: 100 }, [], { id: 'note-1', text: 'Hello' })
  const itemB: WallItem = createWallItem('note', { x: 300, y: 100 }, [itemA], { id: 'note-2', text: 'World' })
  const arrow: WallItem = createWallItem('arrow', { x: 200, y: 100 }, [itemA, itemB], {
    id: 'arrow-1',
    from: 'note-1',
    to: 'note-2',
    text: 'Points to'
  })

  const sampleDoc: WallDoc = {
    version: 1,
    items: [itemA, itemB, arrow],
    camera: { x: 50, y: 50, zoom: 1.25 },
    background: 'grid-warm',
    frameOrder: ['frame-1']
  }

  it('buildWallJsonExport creates standard JSON export format', () => {
    const exported = buildWallJsonExport(sampleDoc, 'Level 1 Wall')
    expect(exported.checkpointType).toBe('wall')
    expect(exported.version).toBe(1)
    expect(exported.name).toBe('Level 1 Wall')
    expect(typeof exported.exportedAt).toBe('string')
    expect(exported.wall.items).toHaveLength(3)
    expect(exported.wall.camera).toEqual({ x: 50, y: 50, zoom: 1.25 })
    expect(exported.wall.background).toBe('grid-warm')
  })

  it('buildWallJsonExport supports selective export of items', () => {
    const exported = buildWallJsonExport(sampleDoc, 'Selection', [itemA])
    expect(exported.checkpointType).toBe('wall')
    expect(exported.name).toBe('Selection')
    expect(exported.wall.items).toHaveLength(1)
    expect(exported.wall.items[0].id).toBe('note-1')
  })

  it('extractWallExportMeta extracts name and timestamp from export payload', () => {
    const exported = buildWallJsonExport(sampleDoc, 'Design Wall')
    const jsonString = JSON.stringify(exported)

    const metaFromString = extractWallExportMeta(jsonString)
    expect(metaFromString.name).toBe('Design Wall')
    expect(metaFromString.exportedAt).toBe(exported.exportedAt)

    const metaFromObject = extractWallExportMeta(exported)
    expect(metaFromObject.name).toBe('Design Wall')

    expect(extractWallExportMeta(null)).toEqual({})
    expect(extractWallExportMeta('not json')).toEqual({})
    expect(extractWallExportMeta({})).toEqual({})
  })

  it('normalizeWallDoc unwraps exported payload into full WallDoc', () => {
    const exported = buildWallJsonExport(sampleDoc, 'Level 1 Wall')
    const jsonString = JSON.stringify(exported)

    const normalized = normalizeWallDoc(jsonString)
    expect(normalized.version).toBe(1)
    expect(normalized.items).toHaveLength(3)
    expect(normalized.camera).toEqual({ x: 50, y: 50, zoom: 1.25 })
    expect(normalized.background).toBe('grid-warm')
    expect(normalized.frameOrder).toEqual(['frame-1'])

    // Arrow links to items remain valid
    const loadedArrow = normalized.items.find(i => i.kind === 'arrow')
    expect(loadedArrow?.from).toBe('note-1')
    expect(loadedArrow?.to).toBe('note-2')
    expect(loadedArrow?.text).toBe('Points to')
  })

  it('normalizeWallDoc still works with raw unnested WallDoc or partial object', () => {
    const directDoc = normalizeWallDoc(sampleDoc)
    expect(directDoc.items).toHaveLength(3)
    expect(directDoc.background).toBe('grid-warm')

    const rawJson = JSON.stringify({ items: [{ kind: 'note', id: 'n1', x: 0, y: 0 }] })
    const normalizedRaw = normalizeWallDoc(rawJson)
    expect(normalizedRaw.items).toHaveLength(1)
  })

  it('placeClip accurately merges imported items with fresh IDs and connector retargeting', () => {
    const exported = buildWallJsonExport(sampleDoc, 'Imported')
    const importedDoc = normalizeWallDoc(exported)

    const existingItem = createWallItem('note', { x: 0, y: 0 }, [], { id: 'existing-1' })
    const dropAt = { x: 500, y: 500 }

    const placed = placeClip({ version: 1, items: importedDoc.items }, [existingItem], dropAt)

    expect(placed).toHaveLength(3)
    // IDs must be regenerated so they never collide with existing canvas items
    const placedNote1 = placed.find(i => i.text === 'Hello')!
    const placedNote2 = placed.find(i => i.text === 'World')!
    const placedArrow = placed.find(i => i.kind === 'arrow')!

    expect(placedNote1.id).not.toBe('note-1')
    expect(placedNote2.id).not.toBe('note-2')
    expect(placedArrow.id).not.toBe('arrow-1')

    // Arrow references must be remapped to the new note IDs!
    expect(placedArrow.from).toBe(placedNote1.id)
    expect(placedArrow.to).toBe(placedNote2.id)

    // Items must be centered around drop position
    const bounds = boundsOf(placed)!
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    expect(Math.round(centerX)).toBe(dropAt.x)
    expect(Math.round(centerY)).toBe(dropAt.y)
  })
})
