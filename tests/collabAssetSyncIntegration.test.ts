// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chunkAsset,
  AssetAssembler,
  scanMissingWallAssets
} from '../src/renderer/src/lib/webrtcAssetSync'
import type { WallDoc } from '../src/shared/wallModel'
import type { AssetChunkMessage, AssetRequestMessage } from '../src/shared/collabProtocol'

describe('WebRTC Asset Synchronization Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('performs end-to-end chunking, request, transmission, and assembly of an image asset', async () => {
    // 1. Peer A holds a 100KB image buffer in their media storage
    const originalImageBytes = new Uint8Array(100 * 1024)
    for (let i = 0; i < originalImageBytes.length; i++) {
      originalImageBytes[i] = (i * 17 + 23) % 256
    }
    const filename = 'shared-canvas-art.png'
    const context = 'ws-collab-room'

    // Peer A's storage
    const peerAStorage = new Map<string, ArrayBuffer>([
      [filename, originalImageBytes.buffer]
    ])

    // Peer B's storage (initially empty)
    const peerBStorage = new Map<string, ArrayBuffer>()

    // 2. Peer B receives a Wall document with the image item
    const wallDoc: WallDoc = {
      version: 1,
      background: 'dots',
      items: [
        {
          id: 'img-1',
          kind: 'image',
          ref: filename,
          x: 100,
          y: 200,
          width: 400,
          height: 300,
          z: 1
        }
      ],
      camera: { x: 0, y: 0, zoom: 1 }
    }

    // 3. Peer B scans document for missing assets
    const missingAssets = await scanMissingWallAssets(wallDoc, async (fn) => peerBStorage.has(fn))
    expect(missingAssets).toEqual([filename])

    // 4. Peer B issues an asset-request to Peer A
    const assetRequest: AssetRequestMessage = {
      type: 'asset-request',
      context,
      filename: missingAssets[0],
      requesterId: 'peer-b'
    }

    // 5. Peer A receives request, loads buffer from storage and chunks it
    const requestedBuf = peerAStorage.get(assetRequest.filename)
    expect(requestedBuf).toBeDefined()
    if (!requestedBuf) throw new Error('requestedBuf missing')

    const CHUNK_SIZE = 16 * 1024 // 16KB binary chunks
    const chunks: AssetChunkMessage[] = chunkAsset(
      assetRequest.filename,
      requestedBuf,
      context,
      CHUNK_SIZE,
      'image/png'
    )

    expect(chunks.length).toBe(7) // 100KB / 16KB = 6.25 -> 7 chunks
    for (const chunk of chunks) {
      expect(chunk.type).toBe('asset-chunk')
      expect(chunk.filename).toBe(filename)
      expect(chunk.totalBytes).toBe(100 * 1024)
    }

    // 6. Peer B receives the chunks across the data channel
    const peerBAssembler = new AssetAssembler()
    const assetReceivedSpy = vi.fn()
    window.addEventListener('collab-asset-received', assetReceivedSpy)

    let assembledBuffer: ArrayBuffer | null = null

    // Simulate network jitter / transfer (e.g., delivered out of order)
    const shuffledIndices = [3, 0, 4, 1, 6, 2, 5]
    for (const idx of shuffledIndices) {
      const chunk = chunks[idx]
      const result = peerBAssembler.acceptChunk(chunk)
      if (result) {
        assembledBuffer = result
        peerBStorage.set(chunk.filename, assembledBuffer)
        window.dispatchEvent(
          new CustomEvent('collab-asset-received', {
            detail: { filename: chunk.filename }
          })
        )
      }
    }

    // 7. Verify Peer B assembled the exact binary buffer
    expect(assembledBuffer).not.toBeNull()
    if (!assembledBuffer) throw new Error('assembledBuffer missing')
    const receivedBytes = new Uint8Array(assembledBuffer)
    expect(receivedBytes.byteLength).toBe(originalImageBytes.byteLength)
    expect(receivedBytes).toEqual(originalImageBytes)

    // Verify storage received it and event fired
    expect(peerBStorage.has(filename)).toBe(true)
    expect(assetReceivedSpy).toHaveBeenCalledTimes(1)
    expect(assetReceivedSpy.mock.calls[0][0].detail).toEqual({ filename })

    // 8. Re-scan wall doc now shows 0 missing assets on Peer B
    const recheckMissing = await scanMissingWallAssets(wallDoc, async (fn) => peerBStorage.has(fn))
    expect(recheckMissing).toHaveLength(0)

    window.removeEventListener('collab-asset-received', assetReceivedSpy)
  })
})
