/** a picture file's own size in pixels, null when the browser can't read it */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  // Try createImageBitmap first: directly reads dimensions in memory without DOM Image or URL schemes
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file)
      const size = { width: bmp.width, height: bmp.height }
      bmp.close()
      if (size.width > 0 && size.height > 0) return size
    }
  } catch {
    // fallback to DOM Image
  }

  // Next try object URL with fallback to data URL
  let url = ''
  try {
    url = URL.createObjectURL(file)
  } catch {
    // createObjectURL failed, will use FileReader
  }

  if (url) {
    try {
      const size = await new Promise<{ width: number; height: number } | null>(resolve => {
        const img = new Image()
        img.onload = () => resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
        img.onerror = () => resolve(null)
        img.src = url
      })
      if (size) return size
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // Fallback to FileReader data URL
  return new Promise<{ width: number; height: number } | null>(resolve => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
      img.onerror = () => resolve(null)
      img.src = String(reader.result ?? '')
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

/** read the natural size of an image from an image URL (such as checkpoint-media://) */
export function readImageUrlSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    img.onerror = () => resolve(null)
    img.src = url
  })
}
