/** the window onto a picture: fractions of the whole, so it survives any resize of the item */

import type { ImageCrop, WallItem } from './wallModel'

export const FULL_CROP: ImageCrop = { x: 0, y: 0, w: 1, h: 1 }

/** what an item shows now, the whole picture when it has never been cropped */
export const cropOf = (item: WallItem): ImageCrop => item.crop ?? FULL_CROP

/** nothing smaller is worth showing, and handles would cross over each other */
const MIN_SIDE = 0.05

/** the eight edges and corners a crop box is dragged by */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/** a handle dragged by fractions of the picture; the opposite side stays where it is */
export function dragCrop(crop: ImageCrop, handle: CropHandle, dx: number, dy: number): ImageCrop {
  if (handle === 'move') {
    return {
      ...crop,
      x: clamp(crop.x + dx, 0, 1 - crop.w),
      y: clamp(crop.y + dy, 0, 1 - crop.h)
    }
  }

  const right = crop.x + crop.w
  const bottom = crop.y + crop.h
  let { x, y, w, h } = crop

  if (handle.includes('w')) {
    x = clamp(crop.x + dx, 0, right - MIN_SIDE)
    w = right - x
  }
  if (handle.includes('e')) {
    w = clamp(crop.w + dx, MIN_SIDE, 1 - crop.x)
  }
  if (handle.includes('n')) {
    y = clamp(crop.y + dy, 0, bottom - MIN_SIDE)
    h = bottom - y
  }
  if (handle.includes('s')) {
    h = clamp(crop.h + dy, MIN_SIDE, 1 - crop.y)
  }

  return { x, y, w, h }
}

/** the whole picture again, which the model stores as no crop at all */
export const isFullCrop = (crop: ImageCrop): boolean =>
  crop.x <= 0 && crop.y <= 0 && crop.w >= 1 && crop.h >= 1

/**
 * the height that keeps the cropped pixels square-on at the item's width, so nothing stretches;
 * natural is the picture's own size in pixels
 */
export function cropHeight(crop: ImageCrop, width: number, natural: { width: number; height: number }): number {
  if (natural.width <= 0 || natural.height <= 0 || crop.w <= 0) return width
  const ratio = (crop.h * natural.height) / (crop.w * natural.width)
  return Math.max(32, Math.round(width * ratio))
}

/** where to put a picture inside a box that shows only this slice of it, as CSS percentages */
export function cropFrame(crop: ImageCrop): { left: string; top: string; width: string; height: string } {
  return {
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    width: `${(1 / crop.w) * 100}%`,
    height: `${(1 / crop.h) * 100}%`
  }
}

/** the same slice as a source rectangle in the picture's own pixels, for canvas and export */
export function cropPixels(
  crop: ImageCrop,
  natural: { width: number; height: number }
): { sx: number; sy: number; sw: number; sh: number } {
  return {
    sx: crop.x * natural.width,
    sy: crop.y * natural.height,
    sw: crop.w * natural.width,
    sh: crop.h * natural.height
  }
}
