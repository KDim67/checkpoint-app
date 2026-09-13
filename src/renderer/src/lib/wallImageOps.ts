/** plumbing from imageProcessing to wall images */

import { computePbrMaps, extractPalette, scale2xData, scale3xData } from './imageProcessing'
import * as mediaApi from '../data/media'

/** middle settings, so no dialogue first */
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

/** offscreen canvas; checkpoint-media:// doesn't taint it */
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

/** returns the new filename */
async function savePixels(pixels: Pixels): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not write the image.')
  // via the context, new ImageData wants a narrower buffer type
  const image = ctx.createImageData(pixels.width, pixels.height)
  image.data.set(pixels.data)
  ctx.putImageData(image, 0, 0)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode the image.')

  return mediaApi.saveFromBuffer(await blob.arrayBuffer(), 'png')
}

interface DerivedImage {
  filename: string
  /** appended to the caption */
  label: string
  width: number
  height: number
}

/** one pass makes all four, and a material is the set */
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

/** 2x or 3x EPX */
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

/** as hex */
export async function derivePalette(filename: string, count = 6): Promise<string[]> {
  const { data } = await loadPixels(filename)
  return extractPalette(data, count)
}
