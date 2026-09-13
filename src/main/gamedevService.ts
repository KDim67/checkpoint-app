import { rename, writeFile, readFile, readdir } from 'fs/promises'
import { isAbsolute, dirname, extname, basename, join } from 'path'
import { existsSync } from 'fs'
import { dialog } from 'electron'
import { errorMessage } from '../shared/errors'

interface RenameResult {
  success: boolean
  renamedCount: number
  errors: Array<{ oldPath: string; newPath: string; error: string }>
}

/** windows names are case-insensitive, sprite.png to Sprite.png renames onto itself */
function sameFile(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** never overwrites: rename clobbers silently and presets rerun onto existing names; swaps refused, not reordered */
export async function batchRenameFiles(
  files: Array<{ oldPath: string; newPath: string }>
): Promise<RenameResult> {
  let renamedCount = 0
  const errors: Array<{ oldPath: string; newPath: string; error: string }> = []
  /** destinations already claimed earlier in this batch */
  const claimed = new Set<string>()

  for (const { oldPath, newPath } of files) {
    try {
      if (!oldPath || !newPath) {
        throw new Error('Paths cannot be empty')
      }
      if (!isAbsolute(oldPath) || !isAbsolute(newPath)) {
        throw new Error('Paths must be absolute')
      }
      if (!existsSync(oldPath)) {
        throw new Error(`Source file does not exist: ${oldPath}`)
      }

      const claimKey = process.platform === 'win32' ? newPath.toLowerCase() : newPath
      if (claimed.has(claimKey)) {
        throw new Error(`Another file in this batch is already becoming ${newPath}`)
      }
      // renaming onto its own name isn't a collision
      if (!sameFile(oldPath, newPath) && existsSync(newPath)) {
        throw new Error(`Something already exists at ${newPath}`)
      }

      await rename(oldPath, newPath)
      claimed.add(claimKey)
      renamedCount++
    } catch (err) {
      console.error(`Failed to rename ${oldPath} to ${newPath}:`, err)
      errors.push({
        oldPath,
        newPath,
        error: errorMessage(err)
      })
    }
  }

  return {
    success: errors.length === 0,
    renamedCount,
    errors
  }
}

export async function selectTextureFile(): Promise<{ path: string; dataUrl: string } | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select Albedo Texture',
    properties: ['openFile'],
    filters: [
      { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'tga'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]
  return await loadTextureFile(filePath)
}

export async function loadTextureFile(filePath: string): Promise<{ path: string; dataUrl: string } | null> {
  try {
    if (!filePath || !isAbsolute(filePath) || !existsSync(filePath)) {
      return null
    }

    const buffer = await readFile(filePath)
    const ext = extname(filePath).toLowerCase().replace('.', '')
    let mimeType = 'image/png'
    if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg'
    else if (ext === 'webp') mimeType = 'image/webp'
    else if (ext === 'bmp') mimeType = 'image/bmp'
    else if (ext === 'gif') mimeType = 'image/gif'

    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    return { path: filePath, dataUrl }
  } catch (err) {
    console.error('Failed to load texture file:', err)
    return null
  }
}

export async function savePbrMaps(
  albedoPath: string,
  maps: { normal?: string; height?: string; roughness?: string; ao?: string }
): Promise<{ success: boolean; writtenFiles: string[]; error?: string }> {
  try {
    if (!albedoPath || !isAbsolute(albedoPath)) {
      throw new Error('Base albedo path must be absolute')
    }

    const dir = dirname(albedoPath)
    const ext = extname(albedoPath)
    const baseName = basename(albedoPath, ext)

    // drop albedo/color suffixes
    let cleanBase = baseName
    const albedoSuffixes = [
      '_albedo', '_Albedo', '-albedo', '-Albedo',
      '_color', '_Color', '-color', '-Color',
      '_diffuse', '_Diffuse', '-diffuse', '-Diffuse',
      '_basecolor', '_BaseColor', '-basecolor', '-BaseColor',
      '_baseColor', '-baseColor'
    ]
    for (const suffix of albedoSuffixes) {
      if (cleanBase.endsWith(suffix)) {
        cleanBase = cleanBase.substring(0, cleanBase.length - suffix.length)
        break
      }
    }

    const writtenFiles: string[] = []

    for (const [mapType, dataUrl] of Object.entries(maps)) {
      if (!dataUrl) continue

      const matches = dataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/)
      if (!matches || matches.length !== 3) {
        throw new Error(`Invalid data URL for map type: ${mapType}`)
      }

      const buffer = Buffer.from(matches[2], 'base64')
      const targetFilename = `${cleanBase}_${mapType}.png` // png, lossless
      const targetPath = join(dir, targetFilename)

      await writeFile(targetPath, buffer)
      writtenFiles.push(targetPath)
    }

    return {
      success: true,
      writtenFiles
    }
  } catch (err) {
    console.error('Failed to save PBR maps:', err)
    return {
      success: false,
      writtenFiles: [],
      error: errorMessage(err)
    }
  }
}

export async function saveSeamlessTexture(
  originalPath: string,
  dataUrl: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    if (!originalPath || !isAbsolute(originalPath)) {
      throw new Error('Base file path must be absolute')
    }

    const dir = dirname(originalPath)
    const ext = extname(originalPath)
    const baseName = basename(originalPath, ext)

    let cleanBase = baseName
    const albedoSuffixes = [
      '_albedo', '_Albedo', '-albedo', '-Albedo',
      '_color', '_Color', '-color', '-Color',
      '_diffuse', '_Diffuse', '-diffuse', '-Diffuse',
      '_basecolor', '_BaseColor', '-basecolor', '-BaseColor',
      '_baseColor', '-baseColor',
      '_seamless', '-seamless'
    ]
    for (const suffix of albedoSuffixes) {
      if (cleanBase.endsWith(suffix)) {
        cleanBase = cleanBase.substring(0, cleanBase.length - suffix.length)
        break
      }
    }

    const matches = dataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/)
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 data URL')
    }

    const buffer = Buffer.from(matches[2], 'base64')
    const targetFilename = `${cleanBase}_seamless.png` // png, lossless
    const targetPath = join(dir, targetFilename)

    await writeFile(targetPath, buffer)

    return {
      success: true,
      filePath: targetPath
    }
  } catch (err) {
    console.error('Failed to save seamless texture:', err)
    return {
      success: false,
      error: errorMessage(err)
    }
  }
}

export async function selectFolder(): Promise<{ path: string; files: Array<{ name: string; path: string; dataUrl: string }> } | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select Folder of Sprites',
    properties: ['openDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const folderPath = result.filePaths[0]
  const filenames = await readdir(folderPath)
  const pngFiles = filenames.filter(f => extname(f).toLowerCase() === '.png')

  // more than this crashes chrome
  const MAX_FILES = 200
  const limitedFiles = pngFiles.slice(0, MAX_FILES)

  const files: Array<{ name: string; path: string; dataUrl: string }> = []
  for (const file of limitedFiles) {
    const filePath = join(folderPath, file)
    const data = await loadTextureFile(filePath)
    if (data) {
      files.push({
        name: file,
        path: filePath,
        dataUrl: data.dataUrl
      })
    }
  }

  return { path: folderPath, files }
}

export async function saveSpriteAtlas(
  folderPath: string,
  atlasDataUrl: string,
  atlasJson: string
): Promise<{ success: boolean; pngPath?: string; jsonPath?: string; error?: string }> {
  try {
    if (!folderPath || !isAbsolute(folderPath)) {
      throw new Error('Folder path must be absolute')
    }

    const matches = atlasDataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/)
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid atlas data URL')
    }
    const buffer = Buffer.from(matches[2], 'base64')

    const pngPath = join(folderPath, 'atlas.png')
    const jsonPath = join(folderPath, 'atlas.json')

    await writeFile(pngPath, buffer)
    await writeFile(jsonPath, atlasJson)

    return {
      success: true,
      pngPath,
      jsonPath
    }
  } catch (err) {
    console.error('Failed to save sprite atlas:', err)
    return {
      success: false,
      error: errorMessage(err)
    }
  }
}

export async function saveSlicedSprites(
  originalPath: string,
  files: Array<{ index: number; dataUrl: string }>
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    if (!originalPath || !isAbsolute(originalPath)) {
      throw new Error('Base original path must be absolute')
    }
    const dir = dirname(originalPath)
    const ext = extname(originalPath)
    const baseName = basename(originalPath, ext)

    let count = 0
    for (const file of files) {
      const matches = file.dataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/)
      if (!matches || matches.length !== 3) continue

      const buffer = Buffer.from(matches[2], 'base64')
      const paddedIndex = String(file.index).padStart(3, '0')
      const targetFilename = `${baseName}_${paddedIndex}.png`
      const targetPath = join(dir, targetFilename)

      await writeFile(targetPath, buffer)
      count++
    }

    return { success: true, count }
  } catch (err) {
    console.error('Failed to save sliced sprites:', err)
    return { success: false, count: 0, error: errorMessage(err) }
  }
}

export async function saveLutTexture(
  originalPath: string,
  dataUrl: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    if (!originalPath || !isAbsolute(originalPath)) {
      throw new Error('Base file path must be absolute')
    }
    const dir = dirname(originalPath)
    const ext = extname(originalPath)
    const baseName = basename(originalPath, ext)

    const matches = dataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/)
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid LUT data URL')
    }
    const buffer = Buffer.from(matches[2], 'base64')
    const targetFilename = `${baseName}_lut.png`
    const targetPath = join(dir, targetFilename)

    await writeFile(targetPath, buffer)

    return { success: true, filePath: targetPath }
  } catch (err) {
    console.error('Failed to save LUT texture:', err)
    return { success: false, error: errorMessage(err) }
  }
}

export async function saveUpscaledTexture(
  originalPath: string,
  suffix: string,
  dataUrl: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    if (!originalPath || !isAbsolute(originalPath)) {
      throw new Error('Base file path must be absolute')
    }
    const dir = dirname(originalPath)
    const ext = extname(originalPath)
    const baseName = basename(originalPath, ext)

    const matches = dataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/)
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid upscaled data URL')
    }
    const buffer = Buffer.from(matches[2], 'base64')
    const targetFilename = `${baseName}_upscaled_${suffix}.png`
    const targetPath = join(dir, targetFilename)

    await writeFile(targetPath, buffer)

    return { success: true, filePath: targetPath }
  } catch (err) {
    console.error('Failed to save upscaled texture:', err)
    return { success: false, error: errorMessage(err) }
  }
}

