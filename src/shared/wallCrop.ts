/** the window onto a picture: fractions of the whole, so it survives any resize of the item */

import type { ImageCrop, WallItem } from './wallModel'
import { toLocal } from './wallTurn'

export const FULL_CROP: ImageCrop = { x: 0, y: 0, w: 1, h: 1 }

/** what an item shows now, the whole picture when it has never been cropped */
export const cropOf = (item: WallItem): ImageCrop => item.crop ?? FULL_CROP

/** nothing smaller is worth showing, and handles would cross over each other */
const MIN_SIDE = 0.05

/** the eight edges and corners a crop box is dragged by */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/** a picture's size as shown, for keeping a shape */
export interface PictureSize { width: number; height: number }

/** width over height of the kept part as it shows, so a shape is the one people see */
export const pixelRatio = (crop: ImageCrop, picture: PictureSize): number =>
  (crop.w * picture.width) / (crop.h * picture.height)

/** how many fractions of height one fraction of width makes at this shape */
const heightPerWidth = (ratio: number, picture: PictureSize): number => picture.width / (picture.height * ratio)

/**
 * a handle dragged by fractions of the picture; the opposite side stays where it is.
 * with a shape, a corner keeps it and follows whichever way the pointer went further
 */
export function dragCrop(
  crop: ImageCrop,
  handle: CropHandle,
  dx: number,
  dy: number,
  keep?: { ratio: number; picture: PictureSize }
): ImageCrop {
  if (handle === 'move') {
    return {
      ...crop,
      x: clamp(crop.x + dx, 0, 1 - crop.w),
      y: clamp(crop.y + dy, 0, 1 - crop.h)
    }
  }

  const right = crop.x + crop.w
  const bottom = crop.y + crop.h

  if (keep && handle.length === 2) {
    const k = heightPerWidth(keep.ratio, keep.picture)
    const west = handle.includes('w')
    const north = handle.includes('n')
    const byWidth = crop.w + (west ? -dx : dx)
    const byHeight = (crop.h + (north ? -dy : dy)) / k
    const wanted = Math.abs(byWidth - crop.w) >= Math.abs(byHeight - crop.w) ? byWidth : byHeight
    // room from the corner that stays, across and down, both in widths
    const most = Math.min(west ? right : 1 - crop.x, (north ? bottom : 1 - crop.y) / k)
    const least = Math.min(most, Math.max(MIN_SIDE, MIN_SIDE / k))
    const w = clamp(wanted, least, most)
    const h = w * k
    return { x: west ? right - w : crop.x, y: north ? bottom - h : crop.y, w, h }
  }

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

/** the largest window of a shape that fits inside this one, about the same middle */
export function fitRatio(crop: ImageCrop, ratio: number, picture: PictureSize): ImageCrop {
  const k = heightPerWidth(ratio, picture)
  const w = crop.w * k <= crop.h ? crop.w : crop.h / k
  const h = w * k
  return { x: crop.x + (crop.w - w) / 2, y: crop.y + (crop.h - h) / 2, w, h }
}

/** the whole picture again, which the model stores as no crop at all */
export const isFullCrop = (crop: ImageCrop): boolean =>
  crop.x <= 0 && crop.y <= 0 && crop.w >= 1 && crop.h >= 1

/**
 * the item's new box with the kept part exactly where it showed, at the same size, so nothing jumps or zooms;
 * a turned item turns about its middle, so the middle moves along the turn
 */
export function cropInPlace(item: WallItem, next: ImageCrop): { x: number; y: number; width: number; height: number } {
  const now = cropOf(item)
  const fullWidth = item.width / now.w
  const fullHeight = item.height / now.h
  const width = next.w * fullWidth
  const height = next.h * fullHeight
  // from the middle of what shows now to the middle of what is kept, in the item's own directions
  const across = (next.x + next.w / 2 - (now.x + now.w / 2)) * fullWidth
  const down = (next.y + next.h / 2 - (now.y + now.h / 2)) * fullHeight
  const [shiftX, shiftY] = toLocal(across, down, -(item.rotation ?? 0))
  const middleX = item.x + item.width / 2 + shiftX
  const middleY = item.y + item.height / 2 + shiftY
  return { x: middleX - width / 2, y: middleY - height / 2, width, height }
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
