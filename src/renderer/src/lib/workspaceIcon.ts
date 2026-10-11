/** a workspace's picture: any photo or logo trimmed to a centred square and shrunk to a tile, a few kilobytes to keep and sync */

import { saveFromBuffer } from '../data/media'

/** the tile is drawn at 2rem, and this stays sharp at twice that and more */
export const ICON_PX = 128
/** decoding a camera-sized file to make a tile isn't worth the wait */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024
/** what a canvas can draw; SVG stays out, a file that can carry scripts and links */
export const ICON_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']

/** the largest square in the middle of an image, in its own pixels */
export function centredSquare(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height)
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size }
}

export const iconUrl = (icon: string): string => `checkpoint-media://${encodeURIComponent(icon)}`

/** read, trimmed and shrunk here, then kept with the app's other media; resolves to the stored file's name */
export async function storeWorkspaceIcon(file: File): Promise<string> {
  if (!ICON_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, GIF, AVIF or BMP image.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That image is over 25 MB. Choose a smaller one.')

  const bitmap = await createImageBitmap(file)
  try {
    const { x, y, size } = centredSquare(bitmap.width, bitmap.height)
    // a small logo is kept at its own size, never blown up into a blur
    const side = Math.min(ICON_PX, size)
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const context = canvas.getContext('2d')
    if (!context) throw new Error("This window can't draw images right now.")
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, x, y, size, size, 0, 0, side, side)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.9))
    if (!blob) throw new Error("That image couldn't be converted.")
    return await saveFromBuffer(await blob.arrayBuffer(), 'webp')
  } finally {
    bitmap.close()
  }
}
