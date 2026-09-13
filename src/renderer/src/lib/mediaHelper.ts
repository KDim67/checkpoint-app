/** copies pasted/dropped images into media and inserts checkpoint-media:// links */

import * as mediaApi from '../data/media'
import * as appApi from '../data/app'

export async function handleImagePaste(
  e: React.ClipboardEvent<HTMLTextAreaElement>,
  currentValue: string,
  setValue: (val: string) => void
): Promise<boolean> {
  const files = e.clipboardData?.files ? Array.from(e.clipboardData.files) : []
  const imageFiles = files.filter(file => file.type.startsWith('image/'))

  if (imageFiles.length > 0) {
    e.preventDefault()
    const target = e.currentTarget
    const start = target ? target.selectionStart : currentValue.length
    const end = target ? target.selectionEnd : currentValue.length

    try {
      let markdownImgs = ''
      for (const file of imageFiles) {
        const arrayBuffer = await file.arrayBuffer()
        const mimeType = file.type || 'image/png'
        const ext = mimeType.split('/')[1] || 'png'

        const filename = await mediaApi.saveFromBuffer(arrayBuffer, ext)
        markdownImgs += `\n![Pasted Image](checkpoint-media://${filename})\n`
      }

      const newValue = currentValue.substring(0, start) + markdownImgs + currentValue.substring(end)
      setValue(newValue)

      // cursor after the inserted images
      const newCursorPos = start + markdownImgs.length
      setTimeout(() => {
        if (target) {
          target.focus()
          target.setSelectionRange(newCursorPos, newCursorPos)
        }
      }, 0)

      return true
    } catch (err) {
      console.error('[mediaHelper] Failed to paste multiple images:', err)
      return false
    }
  }

  // single-item clipboard fallback
  const items = e.clipboardData?.items
  if (!items) return false

  let imageItem: DataTransferItem | null = null
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      imageItem = items[i]
      break
    }
  }

  if (!imageItem) {
    return false // leave plain text to the normal paste
  }

  e.preventDefault()
  
  const target = e.currentTarget
  const start = target ? target.selectionStart : currentValue.length
  const end = target ? target.selectionEnd : currentValue.length

  try {
    const file = imageItem.getAsFile()
    if (!file) return false

    const arrayBuffer = await file.arrayBuffer()
    const mimeType = file.type || 'image/png'
    const ext = mimeType.split('/')[1] || 'png'

    const filename = await mediaApi.saveFromBuffer(arrayBuffer, ext)
    const markdownImg = `\n![Pasted Image](checkpoint-media://${filename})\n`

    const newValue = currentValue.substring(0, start) + markdownImg + currentValue.substring(end)
    setValue(newValue)
    
    // cursor after the inserted image
    const newCursorPos = start + markdownImg.length
    setTimeout(() => {
      if (target) {
        target.focus()
        target.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)

    return true
  } catch (err) {
    console.error('[mediaHelper] Failed to paste single image:', err)
    return false
  }
}

export async function handleImageDrop(
  e: React.DragEvent<HTMLTextAreaElement>,
  currentValue: string,
  setValue: (val: string) => void
): Promise<boolean> {
  const files = Array.from(e.dataTransfer.files)
  const imageFiles = files.filter(file => file.type.startsWith('image/'))

  if (imageFiles.length === 0) {
    return false // leave non-images to the normal drop
  }

  e.preventDefault()
  e.stopPropagation()

  const target = e.currentTarget
  const start = target ? target.selectionStart : currentValue.length
  const end = target ? target.selectionEnd : currentValue.length

  try {
    // absolute paths via electron
    const absolutePaths = imageFiles
      .map(file => appApi.getPathForFile(file))
      .filter(Boolean)

    if (absolutePaths.length === 0) return false

    const savedMappings = await mediaApi.saveFilePaths(absolutePaths)
    if (savedMappings.length === 0) return false

    let markdownImgs = ''
    for (const mapping of savedMappings) {
      markdownImgs += `\n![Attached Image](checkpoint-media://${mapping.filename})\n`
    }

    const newValue = currentValue.substring(0, start) + markdownImgs + currentValue.substring(end)
    setValue(newValue)

    const newCursorPos = start + markdownImgs.length
    setTimeout(() => {
      if (target) {
        target.focus()
        target.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)

    return true
  } catch (err) {
    console.error('[mediaHelper] Failed to drop image:', err)
    return false
  }
}
