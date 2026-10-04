/** a picture file's own size in pixels, null when the browser can't read it */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file)
  try {
    // an element, not createImageBitmap, so an SVG measures too
    return await new Promise(resolve => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
      img.onerror = () => resolve(null)
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
