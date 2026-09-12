/**
 * Runs the app's texture tooling on an image sitting on the Wall.
 *
 * `imageProcessing.ts` already has the algorithms; this is just the plumbing
 * between them and a wall image.
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

interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * Reads a wall image back into pixels via an offscreen canvas. The DOM node
 * does not expose them. `checkpoint-media://` is same-origin enough not to
 * taint the canvas.
 */
function loadPixels(filename: string): Promise<Pixels> {
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
async function savePixels(pixels: Pixels): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not write the image.')
  // Via the context, not `new ImageData(...)`. That wants a narrower buffer type.
  const image = ctx.createImageData(pixels.width, pixels.height)
  image.data.set(pixels.data)
  ctx.putImageData(image, 0, 0)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode the image.')

  return window.electronAPI.media.saveFromBuffer(await blob.arrayBuffer(), 'png')
}

interface DerivedImage {
  filename: string
  /** Appended to the original's caption, so the wall says what each one is. */
  label: string
  width: number
  height: number
}

/**
 * Height, normal, roughness and AO. All four, because one pass produces them
 * all and a material is the set.
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
