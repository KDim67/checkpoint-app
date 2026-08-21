import fs from 'fs'
import path from 'path'
import { getConfigDir, getMapsDir, ensureDir, resolveSafePath as resolveInDir } from './paths'

/**
 * Initializes the maps directory inside the app's user profile config directory.
 */
export function initMapsFs(): void {
  ensureDir(getConfigDir())
  ensureDir(getMapsDir())
}

function resolveSafePath(name: string): string {
  return resolveInDir(getMapsDir(), name, '.json')
}

/**
 * Lists all map names available in the storage folder.
 */
export function listMaps(): string[] {
  initMapsFs()
  try {
    const files = fs.readdirSync(getMapsDir())
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
