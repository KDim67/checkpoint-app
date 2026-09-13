/** pure over raw buffers, testable without a canvas */

/** a free rect and the two it splits into */
interface PackerNode {
  x: number
  y: number
  w: number
  h: number
  used: boolean
  /** space to the right */
  right?: PackerNode
  /** space below */
  down?: PackerNode
}

export class BinaryTreePacker {
  root: PackerNode

  constructor(w: number, h: number) {
    this.root = { x: 0, y: 0, w, h, used: false }
  }

  fit(w: number, h: number): { x: number; y: number } | null {
    const node = this.findNode(this.root, w, h)
    if (node) {
      return this.splitNode(node, w, h)
    }
    return null
  }

  // undefined once a branch runs out; used leaves have no right/down until split
  findNode(node: PackerNode | undefined, w: number, h: number): PackerNode | null {
    if (!node) return null
    if (node.used) {
      return this.findNode(node.right, w, h) ?? this.findNode(node.down, w, h)
    } else if (w <= node.w && h <= node.h) {
      return node
    }
    return null
  }

  splitNode(node: PackerNode, w: number, h: number): PackerNode {
    node.used = true
    node.down = { x: node.x, y: node.y + h, w: node.w, h: node.h - h, used: false }
    node.right = { x: node.x + w, y: node.y, w: node.w - w, h, used: false }
    return node
  }
}

interface PbrParams {
  normalIntensity: number
  heightDepth: number
  roughnessContrast: number
  roughnessBase: number
  aoIntensity: number
  /** dark as high: crevices vs ridges */
  invertHeight?: boolean
}

/** Sobel over RGBA, no DOM, shared by preview and export */
export function computePbrMaps(src: Uint8ClampedArray, W: number, H: number, params: PbrParams) {
  const { normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight } = params

  const clamped = (x: number, y: number): number =>
    (Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))) * 4

  // luma with clamped borders; inverting here keeps all the maps coherent
  const grayAt = (x: number, y: number): number => {
    const i = clamped(x, y)
    const g = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) / 255
    return invertHeight ? 1 - g : g
  }

  /** fade transparent neighbours to the centre, or sprites get an embossed ridge round their outline */
  const getGray = (x: number, y: number, centre: number): number => {
    const a = src[clamped(x, y) + 3] / 255
    return a >= 1 ? grayAt(x, y) : grayAt(x, y) * a + centre * (1 - a)
  }

  const len = W * H * 4
  const hData = new Uint8ClampedArray(len)
  const nData = new Uint8ClampedArray(len)
  const rData = new Uint8ClampedArray(len)
  const aData = new Uint8ClampedArray(len)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4

      // height (luminance)
      const h = grayAt(x, y)
      const hByte = Math.round(h * 255)
      // source alpha rides along so cutouts stay cutouts
      const srcA = src[i + 3]
      hData[i] = hByte; hData[i + 1] = hByte; hData[i + 2] = hByte; hData[i + 3] = srcA

      // Sobel 3x3
      const h00 = getGray(x - 1, y - 1, h); const h10 = getGray(x, y - 1, h); const h20 = getGray(x + 1, y - 1, h)
      const h01 = getGray(x - 1, y, h);                                        const h21 = getGray(x + 1, y, h)
      const h02 = getGray(x - 1, y + 1, h); const h12 = getGray(x, y + 1, h); const h22 = getGray(x + 1, y + 1, h)
      const dX = (h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02)
      const dY = (h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20)

      // normal: Sobel to unit vector, packed 0-1
      const nx = -dX * normalIntensity
      const ny = -dY * normalIntensity
      const nz = 1.0 / heightDepth
      const mag = Math.sqrt(nx * nx + ny * ny + nz * nz)
      nData[i]     = Math.round(((nx / mag) * 0.5 + 0.5) * 255)
      nData[i + 1] = Math.round(((ny / mag) * 0.5 + 0.5) * 255)
      nData[i + 2] = Math.round(((nz / mag) * 0.5 + 0.5) * 255)
      nData[i + 3] = srcA

      // roughness: contrast + bias on luma
      const rByte = Math.round(Math.max(0, Math.min(1, (h - 0.5) * roughnessContrast + 0.5 + (roughnessBase - 0.5))) * 255)
      rData[i] = rByte; rData[i + 1] = rByte; rData[i + 2] = rByte; rData[i + 3] = srcA

      // AO: gradient magnitude x height
      const gradMag = Math.sqrt(dX * dX + dY * dY)
      const aoByte = Math.round(Math.max(0, Math.min(1, (1 - gradMag * aoIntensity) * (0.3 + 0.7 * h))) * 255)
      aData[i] = aoByte; aData[i + 1] = aoByte; aData[i + 2] = aoByte; aData[i + 3] = srcA
    }
  }

  return { hData, nData, rData, aData }
}

// EPX/AdvMAME over raw RGBA, shared by preview and export

/** packed RGBA with clamped borders */
function makePixelReaders(s: Uint8ClampedArray, w: number, h: number) {
  const idx = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y
    return (cy * w + cx) * 4
  }
  const pix = (x: number, y: number): number => {
    const i = idx(x, y)
    return ((s[i] << 24) | (s[i + 1] << 16) | (s[i + 2] << 8) | s[i + 3]) >>> 0
  }
  return { idx, pix }
}

/** doubles size, keeps hard edges */
export function scale2xData(s: Uint8ClampedArray, w: number, h: number) {
  const { idx, pix } = makePixelReaders(s, w, h)
  const out = new Uint8ClampedArray(w * 2 * h * 2 * 4)
  const put = (dx: number, dy: number, si: number) => {
    const di = (dy * w * 2 + dx) * 4
    out[di] = s[si]; out[di + 1] = s[si + 1]; out[di + 2] = s[si + 2]; out[di + 3] = s[si + 3]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const A = pix(x, y - 1)
      const C = pix(x - 1, y)
      const B = pix(x + 1, y)
      const D = pix(x, y + 1)
      const self = idx(x, y)
      put(x * 2,     y * 2,     (C === A && C !== D && A !== B) ? idx(x, y - 1) : self)
      put(x * 2 + 1, y * 2,     (A === B && A !== C && B !== D) ? idx(x + 1, y) : self)
      put(x * 2,     y * 2 + 1, (D === C && D !== B && C !== A) ? idx(x - 1, y) : self)
      put(x * 2 + 1, y * 2 + 1, (B === D && B !== A && D !== C) ? idx(x + 1, y) : self)
    }
  }
  return out
}

/** triples size, 9-subpixel rules */
export function scale3xData(s: Uint8ClampedArray, w: number, h: number) {
  const { idx, pix } = makePixelReaders(s, w, h)
  const out = new Uint8ClampedArray(w * 3 * h * 3 * 4)
  const put = (dx: number, dy: number, si: number) => {
    const di = (dy * w * 3 + dx) * 4
    out[di] = s[si]; out[di + 1] = s[si + 1]; out[di + 2] = s[si + 2]; out[di + 3] = s[si + 3]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const E = pix(x, y)
      const A = pix(x - 1, y - 1)
      const B = pix(x, y - 1)
      const C = pix(x + 1, y - 1)
      const D = pix(x - 1, y)
      const F = pix(x + 1, y)
      const G = pix(x - 1, y + 1)
      const H = pix(x, y + 1)
      const I = pix(x + 1, y + 1)
      const self = idx(x, y)
      const e1 = (D === B && D !== H && B !== F) ? idx(x - 1, y) : self
      const e2 = ((D === B && D !== H && B !== F && E !== C) || (B === F && B !== D && F !== H && E !== A)) ? idx(x, y - 1) : self
      const e3 = (B === F && B !== D && F !== H) ? idx(x + 1, y) : self
      const e4 = ((D === B && D !== H && B !== F && E !== G) || (D === H && D !== B && H !== F && E !== A)) ? idx(x - 1, y) : self
      const e6 = ((B === F && B !== D && F !== H && E !== I) || (H === F && H !== D && F !== B && E !== C)) ? idx(x + 1, y) : self
      const e7 = (D === H && D !== B && H !== F) ? idx(x - 1, y) : self
      const e8 = ((D === H && D !== B && H !== F && E !== I) || (H === F && H !== D && F !== B && E !== G)) ? idx(x, y + 1) : self
      const e9 = (H === F && H !== D && F !== B) ? idx(x + 1, y) : self
      put(x * 3,     y * 3,     e1)
      put(x * 3 + 1, y * 3,     e2)
      put(x * 3 + 2, y * 3,     e3)
      put(x * 3,     y * 3 + 1, e4)
      put(x * 3 + 1, y * 3 + 1, self)
      put(x * 3 + 2, y * 3 + 1, e6)
      put(x * 3,     y * 3 + 2, e7)
      put(x * 3 + 1, y * 3 + 2, e8)
      put(x * 3 + 2, y * 3 + 2, e9)
    }
  }
  return out
}

interface LutParams {
  exposure: number
  brightness: number
  contrast: number
  saturation: number
  temperature: number
}

/** neutral 256x16 strip, shared by preview and export so both match */
export function buildLutData(params: LutParams) {
  const { exposure, brightness, contrast, saturation, temperature } = params
  const expScale = Math.pow(2, exposure / 100)
  const contrastFactor = (100 + contrast) / 100
  const satFactor = (100 + saturation) / 100
  const tempShift = (temperature / 100) * 20
  const brightVal = (brightness / 100) * 255

  const d = new Uint8ClampedArray(256 * 16 * 4)

  for (let b = 0; b < 16; b++) {
    const blockX = b * 16
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let cr = (x / 15) * 255
        let cg = (y / 15) * 255
        let cb = (b / 15) * 255

        cr *= expScale; cg *= expScale; cb *= expScale
        cr += brightVal; cg += brightVal; cb += brightVal
        cr = (cr - 127.5) * contrastFactor + 127.5
        cg = (cg - 127.5) * contrastFactor + 127.5
        cb = (cb - 127.5) * contrastFactor + 127.5
        cr += tempShift; cb -= tempShift
        const luma = 0.299 * cr + 0.587 * cg + 0.114 * cb
        cr = luma + (cr - luma) * satFactor
        cg = luma + (cg - luma) * satFactor
        cb = luma + (cb - luma) * satFactor

        const idx = (y * 256 + (blockX + x)) * 4
        d[idx]     = Math.max(0, Math.min(255, Math.round(cr)))
        d[idx + 1] = Math.max(0, Math.min(255, Math.round(cg)))
        d[idx + 2] = Math.max(0, Math.min(255, Math.round(cb)))
        d[idx + 3] = 255
      }
    }
  }

  return d
}

/** top four bits per channel, bucket averages; skips near-transparent pixels */
export function extractPalette(src: Uint8ClampedArray, count = 6): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()

  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] < 128) continue
    const r = src[i], g = src[i + 1], b = src[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b
    } else {
      buckets.set(key, { n: 1, r, g, b })
    }
  }

  const hex = (v: number): string => Math.round(v).toString(16).padStart(2, '0')

  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map(c => `#${hex(c.r / c.n)}${hex(c.g / c.n)}${hex(c.b / c.n)}`)
}
