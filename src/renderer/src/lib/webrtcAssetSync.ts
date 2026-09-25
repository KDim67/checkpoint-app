import type { AssetChunkMessage } from '../../../shared/collabProtocol'
import type { WallDoc } from '../../../shared/wallModel'

export const DEFAULT_ASSET_CHUNK_SIZE = 32 * 1024

/**
 * Encodes a Uint8Array into a Base64 string safely without call stack overflow.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  }

  let binary = ''
  const len = bytes.byteLength
  const CHUNK_SIZE = 4096

  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const end = Math.min(i + CHUNK_SIZE, len)
    const slice = bytes.subarray(i, end)
    binary += String.fromCharCode.apply(null, Array.from(slice))
  }

  return btoa(binary)
}

/**
 * Decodes a Base64 string into a Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64, 'base64')
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * Slices an ArrayBuffer asset into transfer chunks ready for WebRTC transmission.
 */
export function chunkAsset(
  filename: string,
  buffer: ArrayBuffer,
  context: string,
  chunkSize: number = DEFAULT_ASSET_CHUNK_SIZE,
  mimeType?: string
): AssetChunkMessage[] {
  const bytes = new Uint8Array(buffer)
  const totalBytes = bytes.byteLength
  const totalChunks = Math.max(1, Math.ceil(totalBytes / chunkSize))
  const chunks: AssetChunkMessage[] = []

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, totalBytes)
    const slice = bytes.subarray(start, end)
    const chunkData = uint8ArrayToBase64(slice)

    chunks.push({
      type: 'asset-chunk',
      context,
      filename,
      chunkIndex: i,
      totalChunks,
      totalBytes,
      chunkData,
      mimeType
    })
  }

  return chunks
}

interface PendingTransfer {
  parts: (Uint8Array | undefined)[]
  received: number
  totalChunks: number
  totalBytes: number
  updatedAt: number
}

/**
 * Reassembles incoming WebRTC asset chunks across multiple frames/chunks.
 */
export class AssetAssembler {
  private transfers = new Map<string, PendingTransfer>()

  /**
   * Accepts a chunk. Returns the completed ArrayBuffer when all chunks have arrived, or null if incomplete.
   */
  public acceptChunk(chunk: AssetChunkMessage): ArrayBuffer | null {
    let transfer = this.transfers.get(chunk.filename)

    if (!transfer) {
      transfer = {
        parts: new Array(chunk.totalChunks),
        received: 0,
        totalChunks: chunk.totalChunks,
        totalBytes: chunk.totalBytes,
        updatedAt: Date.now()
      }
      this.transfers.set(chunk.filename, transfer)
    }

    if (transfer.parts[chunk.chunkIndex] === undefined) {
      transfer.parts[chunk.chunkIndex] = base64ToUint8Array(chunk.chunkData)
      transfer.received++
      transfer.updatedAt = Date.now()
    }

    if (transfer.received >= transfer.totalChunks) {
      this.transfers.delete(chunk.filename)

      const fullBytes = new Uint8Array(transfer.totalBytes)
      let offset = 0

      for (let i = 0; i < transfer.totalChunks; i++) {
        const part = transfer.parts[i]
        if (part) {
          fullBytes.set(part, offset)
          offset += part.byteLength
        }
      }

      return fullBytes.buffer
    }

    return null
  }

  /**
   * Returns how many files are currently mid-transfer.
   */
  public pendingCount(): number {
    return this.transfers.size
  }

  /**
   * Discards abandoned or stalled transfers older than maxAgeMs.
   */
  public prune(maxAgeMs: number = 60_000): void {
    const now = Date.now()
    for (const [filename, transfer] of this.transfers) {
      if (now - transfer.updatedAt > maxAgeMs) {
        this.transfers.delete(filename)
      }
    }
  }

  public reset(): void {
    this.transfers.clear()
  }
}

/**
 * Scans a wall document for image or media asset references that do not exist locally.
 */
export async function scanMissingWallAssets(
  doc: WallDoc,
  checkExists: (filename: string) => Promise<boolean>
): Promise<string[]> {
  const referenced = new Set<string>()

  for (const item of doc.items) {
    if (item.kind === 'image' && item.ref && typeof item.ref === 'string') {
      referenced.add(item.ref)
    }
    if (item.previewImage && typeof item.previewImage === 'string') {
      referenced.add(item.previewImage)
    }
  }

  const missing: string[] = []

  for (const filename of referenced) {
    // Exclude full URLs (http/https)
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      continue
    }

    const exists = await checkExists(filename)
    if (!exists) {
      missing.push(filename)
    }
  }

  return missing
}
