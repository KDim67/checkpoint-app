import { ipcMain, dialog } from 'electron'
import { promises as fs, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname } from 'path'
import { IpcChannels } from '../shared/ipcChannels'

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'out',
  'build',
  '.gemini',
  '.vscode',
  'coverage',
  'temp',
  'tmp'
])

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.scss',
  '.py', '.cs', '.cpp', '.h', '.hpp', '.c', '.go', '.rs', '.java',
  '.kt', '.swift', '.md', '.sql', '.sh', '.bat', '.ps1', '.yaml', '.yml'
])

export interface WorkspaceFileInfo {
  name: string
  relativePath: string
  extension: string
  size: number
}

async function selectWorkspaceFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Codebase Project Folder'
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
}

function indexWorkspaceFiles(dirPath: string): WorkspaceFileInfo[] {
  if (!existsSync(dirPath)) return []
  const filesList: WorkspaceFileInfo[] = []

  function walk(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.has(entry.name)) {
            walk(join(currentDir, entry.name))
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase()
          if (CODE_EXTENSIONS.has(ext)) {
            const fullPath = join(currentDir, entry.name)
            const rel = relative(dirPath, fullPath).replace(/\\/g, '/')
            try {
              const stats = statSync(fullPath)
              filesList.push({
                name: entry.name,
                relativePath: rel,
                extension: ext,
                size: stats.size
              })
            } catch {}
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to read directory ${currentDir}:`, e)
    }
  }

  walk(dirPath)
  return filesList.slice(0, 500) // Cap at 500 files for clean memory performance
}

async function readWorkspaceFile(dirPath: string, relativePath: string): Promise<string> {
  const fullPath = join(dirPath, relativePath)
  if (!existsSync(fullPath)) return ''
  try {
    const content = await fs.readFile(fullPath, 'utf-8')
    return content.length > 50000 ? content.slice(0, 50000) + '\n\n[... File truncated for context memory ...]' : content
  } catch (e) {
    console.warn(`Failed to read workspace file ${relativePath}:`, e)
    return ''
  }
}

export function initWorkspaceIpc(): void {
  ipcMain.handle(IpcChannels.WORKSPACE_SELECT_FOLDER, async () => {
    return selectWorkspaceFolder()
  })

  ipcMain.handle(IpcChannels.WORKSPACE_GET_STRUCTURE, (_event, folderPath: string) => {
    return indexWorkspaceFiles(folderPath)
  })

  ipcMain.handle(IpcChannels.WORKSPACE_READ_FILE, (_event, folderPath: string, relativePath: string) => {
    return readWorkspaceFile(folderPath, relativePath)
  })
}
