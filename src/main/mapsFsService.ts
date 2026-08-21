import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_DIR = path.join(os.homedir(), '.config', 'checkpoint')
const MAPS_DIR = path.join(CONFIG_DIR, 'maps')

/**
 * Initializes the maps directory inside the app's user profile config directory.
 */
export function initMapsFs(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
  if (!fs.existsSync(MAPS_DIR)) {
    fs.mkdirSync(MAPS_DIR, { recursive: true })
  }
}

/**
 * Safely resolves a map filename to a file path within the maps directory,
 * preventing path traversal attacks.
 */
function resolveSafePath(name: string): string {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_')
  const resolvedPath = path.resolve(MAPS_DIR, `${safeName}.json`)
  const rel = path.relative(MAPS_DIR, resolvedPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path traversal detected')
  }
  return resolvedPath
}

/**
 * Lists all map names available in the storage folder.
 */
export function listMaps(): string[] {
  initMapsFs()
  try {
    const files = fs.readdirSync(MAPS_DIR)
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => path.basename(f, '.json'))
  } catch (err) {
    console.error('Failed to list maps:', err)
    return []
  }
}

/**
 * Reads a map file's JSON content from disk.
 */
export function readMap(name: string): string {
  initMapsFs()
  const filePath = resolveSafePath(name)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Map file not found: ${name}`)
  }
  return fs.readFileSync(filePath, 'utf8')
}

/**
 * Writes map JSON content to disk.
 */
export function writeMap(name: string, content: string): void {
  initMapsFs()
  const filePath = resolveSafePath(name)
  fs.writeFileSync(filePath, content, 'utf8')
}

/**
 * Deletes a map file from disk.
 */
export function deleteMap(name: string): void {
  initMapsFs()
  const filePath = resolveSafePath(name)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}
