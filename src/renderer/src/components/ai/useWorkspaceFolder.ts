/**
 * The project folder attached for codebase context. The folder is remembered
 * across sessions and its file list is not, so a restored folder is indexed
 * again on mount.
 */

import { useEffect, useRef, useState } from 'react'
import type { WorkspaceFileInfo } from './types'
import * as workspaceApi from '../../data/workspaceFolder'

const STORAGE_KEY_WORKSPACE_FOLDER = 'checkpoint_ai_workspace_folder'

export function useWorkspaceFolder() {
  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_WORKSPACE_FOLDER) || null
    } catch {
      return null
    }
  })
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileInfo[]>([])
  const [workspaceIndexing, setWorkspaceIndexing] = useState(false)

  // Re-index a previously selected workspace folder on mount. Only the
  // folder restored from the last session is indexed here: picking a new one
  // indexes it where it is picked.
  const restoredFolderRef = useRef(workspaceFolder)
  useEffect(() => {
    const restoredFolder = restoredFolderRef.current
    if (!restoredFolder) return
    let cancelled = false
    setWorkspaceIndexing(true)
    workspaceApi.getStructure(restoredFolder)
      .then(files => { if (!cancelled) setWorkspaceFiles(files || []) })
      .catch(err => console.warn('Failed to re-index workspace folder:', err))
      .finally(() => { if (!cancelled) setWorkspaceIndexing(false) })
    return () => { cancelled = true }
  }, [])

  const handleImportWorkspace = async () => {
    try {
      const folder = await workspaceApi.selectFolder()
      if (!folder) return
      setWorkspaceIndexing(true)
      setWorkspaceFolder(folder)
      try { localStorage.setItem(STORAGE_KEY_WORKSPACE_FOLDER, folder) } catch {}
      const files = await workspaceApi.getStructure(folder)
      setWorkspaceFiles(files || [])
    } catch (err) {
      console.warn('Failed to import workspace folder:', err)
    } finally {
      setWorkspaceIndexing(false)
    }
  }

  const handleClearWorkspace = () => {
    setWorkspaceFolder(null)
    setWorkspaceFiles([])
    try { localStorage.removeItem(STORAGE_KEY_WORKSPACE_FOLDER) } catch {}
  }

  return {
    workspaceFolder,
    workspaceFiles,
    workspaceIndexing,
    handleImportWorkspace,
    handleClearWorkspace
  }
}
