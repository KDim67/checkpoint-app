/**
 * Helper to handle image copy-paste and drag-and-drop actions.
 * Copies the raw files/buffers into local media storage via IPC,
 * and inserts the resulting checkpoint-media:// tags into the input string.
 */

import * as mediaApi from '../data/media'
import * as appApi from '../data/app'

/**
 * Handles paste events on a textarea. Detects images in clipboard,
 * saves them locally, and inserts Markdown image links at the cursor.
 */
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

        // Save image to config/media via Electron IPC
        const filename = await mediaApi.saveFromBuffer(arrayBuffer, ext)
        markdownImgs += `\n![Pasted Image](checkpoint-media://${filename})\n`
      }

      // Insert at current cursor position
      const newValue = currentValue.substring(0, start) + markdownImgs + currentValue.substring(end)
      setValue(newValue)

      // Set selection/cursor position just after the inserted images
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

  // Fallback check for single item clipboard data (legacy browsers or platforms)
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
    return false // Let standard text paste handler deal with it
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

    // Save image to config/media via Electron IPC
    const filename = await mediaApi.saveFromBuffer(arrayBuffer, ext)
    const markdownImg = `\n![Pasted Image](checkpoint-media://${filename})\n`

    // Insert at current cursor position
    const newValue = currentValue.substring(0, start) + markdownImg + currentValue.substring(end)
    setValue(newValue)
    
    // Set selection/cursor position just after the inserted image
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

/**
 * Handles drop events on a textarea. Detects image files dropped,
 * saves them locally, and appends Markdown image links at the cursor.
 */
export async function handleImageDrop(
  e: React.DragEvent<HTMLTextAreaElement>,
  currentValue: string,
  setValue: (val: string) => void
): Promise<boolean> {
  const files = Array.from(e.dataTransfer.files)
  const imageFiles = files.filter(file => file.type.startsWith('image/'))

  if (imageFiles.length === 0) {
    return false // Let standard file drop handler deal with it
  }

  e.preventDefault()
  e.stopPropagation()

  const target = e.currentTarget
  const start = target ? target.selectionStart : currentValue.length
  const end = target ? target.selectionEnd : currentValue.length

  try {
    // Resolve absolute paths for the dropped files via Electron utility
    const absolutePaths = imageFiles
      .map(file => appApi.getPathForFile(file))
      .filter(Boolean)

    if (absolutePaths.length === 0) return false

    // Copy files to local config/media via Electron IPC
    const savedMappings = await mediaApi.saveFilePaths(absolutePaths)
    if (savedMappings.length === 0) return false

    let markdownImgs = ''
    for (const mapping of savedMappings) {
      markdownImgs += `\n![Attached Image](checkpoint-media://${mapping.filename})\n`
    }

    // Insert at current cursor position
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
