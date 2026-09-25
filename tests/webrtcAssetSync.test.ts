import { describe, expect, it, vi } from 'vitest'
import {
  chunkAsset,
  AssetAssembler,
  scanMissingWallAssets,
  uint8ArrayToBase64,
  base64ToUint8Array
} from '../src/renderer/src/lib/webrtcAssetSync'
import type { WallDoc } from '../src/shared/wallModel'

describe('webrtcAssetSync', () => {
  it('encodes and decodes binary to base64 correctly without stack overflow', () => {
    // 65KB test buffer (larger than typical single-chunk call stack limit for String.fromCharCode)
    const original = new Uint8Array(65536)
    for (let i = 0; i < original.length; i++) {
      original[i] = i % 256
    }

    const b64 = uint8ArrayToBase64(original)
    const decoded = base64ToUint8Array(b64)

    expect(decoded.length).toBe(original.length)
    expect(decoded).toEqual(original)
  })

  it('splits a binary asset into chunks correctly', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const chunks = chunkAsset('test.png', data.buffer, 'ws-1', 4)

    expect(chunks).toHaveLength(3) // 4 + 4 + 2 bytes
    expect(chunks[0].chunkIndex).toBe(0)
    expect(chunks[0].totalChunks).toBe(3)
    expect(chunks[0].totalBytes).toBe(10)
    expect(chunks[0].filename).toBe('test.png')
    expect(chunks[0].context).toBe('ws-1')

    expect(chunks[1].chunkIndex).toBe(1)
    expect(chunks[2].chunkIndex).toBe(2)
  })

  it('assembles incoming chunks in and out of order', () => {
    const rawBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    const chunks = chunkAsset('sample.jpg', rawBytes.buffer, 'ws-main', 3)
    // 3, 3, 3, 1 -> 4 chunks

    const assembler = new AssetAssembler()

    // Feed chunks out of order: 2, 0, 3, 1
    expect(assembler.acceptChunk(chunks[2])).toBeNull()
    expect(assembler.acceptChunk(chunks[0])).toBeNull()
    expect(assembler.acceptChunk(chunks[3])).toBeNull()
    const resultBuffer = assembler.acceptChunk(chunks[1])

    expect(resultBuffer).not.toBeNull()
    if (resultBuffer) {
      expect(new Uint8Array(resultBuffer)).toEqual(rawBytes)
    }
  })

  it('prunes stalled partial transfers after timeout', () => {
    vi.useFakeTimers()
    const assembler = new AssetAssembler()
    const chunks = chunkAsset('stalled.png', new Uint8Array([1, 2, 3, 4]).buffer, 'ws', 2)

    assembler.acceptChunk(chunks[0])
    expect(assembler.pendingCount()).toBe(1)

    // Advance 61 seconds
    vi.advanceTimersByTime(61_000)
    assembler.prune(60_000)

    expect(assembler.pendingCount()).toBe(0)
    vi.useRealTimers()
  })

  it('scans a wall doc for missing image and media assets', async () => {
    const wallDoc: WallDoc = {
      version: 1,
      background: 'dots',
      items: [
        {
          id: 'item-1',
          kind: 'image',
          ref: 'photo-1.png',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          z: 1
        },
        {
          id: 'item-2',
          kind: 'note',
          text: 'Hello world',
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          z: 2
        },
        {
          id: 'item-3',
          kind: 'card',
          ref: 'card-1',
          previewImage: 'cover-1.jpg',
          x: 100,
          y: 100,
          width: 100,
          height: 100,
          z: 3
        }
      ],
      camera: { x: 0, y: 0, zoom: 1 }
    }

    const localExisting = new Set(['photo-1.png'])
    const checkExists = async (filename: string) => localExisting.has(filename)

    const missing = await scanMissingWallAssets(wallDoc, checkExists)
    expect(missing).toEqual(['cover-1.jpg'])
  })
})
