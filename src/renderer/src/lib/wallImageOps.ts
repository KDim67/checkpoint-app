/**
 * Running the app's texture tooling on an image sitting on the Wall.
 *
 * The algorithms are not new, `imageProcessing.ts` already computes PBR maps,
 * scales pixel art and extracts palettes, all as pure functions over raw RGBA.
 * What was missing is the plumbing: getting pixels out of an image the Wall is
 * displaying, and getting a result back in as a new image.
 *
 * This is the part no other canvas can copy, because no other canvas ships a
 * texture pipeline to plumb into.
 */

import { computePbrMaps, extractPalette, scale2xData, scale3xData } from './imageProcessing'

/** Sensible middle settings, so the menu entry does not need a dialogue first. */
const PBR_DEFAULTS = {
  normalIntensity: 1,
  heightDepth: 1,
  roughnessContrast: 1,
  roughnessBase: 0.5,
  aoIntensity: 0.6
}

export interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * Reads a wall image back into pixels.
 *
 * The image is already decoded and on screen, but its pixels are not reachable
 * from the DOM node, so it is drawn once into an offscreen canvas. Images are
 * served from the custom `checkpoint-media://` protocol, which is same-origin
 * enough that the canvas does not become tainted.
 */
export function loadPixels(filename: string): Promise<Pixels> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Could not read the image.')); return }
      ctx.drawImage(img, 0, 0)
      try {
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        resolve({ data, width, height })
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Could not read the image.'))
      }
    }
    img.onerror = () => reject(new Error('Could not open the image.'))
    img.src = `checkpoint-media://${filename}`
  })
}

/** Writes pixels back out as a PNG and stores it, returning the new filename. */
export async function savePixels(pixels: Pixels): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not write the image.')
  // Built through the context rather than `new ImageData(...)`: the constructor
  // insists on a buffer type narrower than what the pure image functions return.
  const image = ctx.createImageData(pixels.width, pixels.height)
  image.data.set(pixels.data)
  ctx.putImageData(image, 0, 0)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode the image.')

  return window.electronAPI.media.saveFromBuffer(await blob.arrayBuffer(), 'png')
}

export interface DerivedImage {
  filename: string
  /** Appended to the original's caption, so the wall says what each one is. */
  label: string
  width: number
  height: number
}

/**
 * Height, normal, roughness and ambient occlusion, as four new images.
 *
 * All four are returned rather than offering a choice: they are generated in
 * one pass anyway, and a material is the set of them, picking one at a time
 * would mean running the whole computation four times.
 */
export async function derivePbrMaps(filename: string): Promise<DerivedImage[]> {
  const { data, width, height } = await loadPixels(filename)
  const { hData, nData, rData, aData } = computePbrMaps(data, width, height, PBR_DEFAULTS)

  const maps: [string, Uint8ClampedArray][] = [
    ['height', hData],
    ['normal', nData],
    ['roughness', rData],
    ['ao', aData]
  ]

  const out: DerivedImage[] = []
  for (const [label, mapData] of maps) {
    out.push({
      filename: await savePixels({ data: mapData, width, height }),
      label,
      width,
      height
    })
  }
  return out
}

/** Pixel-art upscale, 2× or 3×, using the EPX family already in the app. */
export async function deriveUpscale(filename: string, factor: 2 | 3): Promise<DerivedImage> {
  const { data, width, height } = await loadPixels(filename)
  const scaled = factor === 2 ? scale2xData(data, width, height) : scale3xData(data, width, height)
  const w = width * factor
  const h = height * factor
  return {
    filename: await savePixels({ data: scaled, width: w, height: h }),
    label: `${factor}x`,
    width: w,
    height: h
  }
}

/** The image's dominant colours, as hex. */
export async function derivePalette(filename: string, count = 6): Promise<string[]> {
  const { data } = await loadPixels(filename)
  return extractPalette(data, count)
}
