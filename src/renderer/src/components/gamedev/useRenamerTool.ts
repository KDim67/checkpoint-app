import { useState, useCallback } from 'react'
import { useToast } from '../ui/Toast'
import type { AssetFile } from './types'

/**
 * Batch Asset Renamer: the file queue, the naming rules, and applying them.
 *
 * A hook rather than state inside RenamerPanel, because the panel unmounts on
 * tab switch and a queued batch would be lost on a glance at another tool.
 */
export function useRenamerTool() {
  const { toast } = useToast()

  const [files, setFiles] = useState<AssetFile[]>([])
  const [renamerPreset, setRenamerPreset] = useState<'none' | 'texture' | 'mesh' | 'audio'>('none')

  const [renamerSuffixPreset, setRenamerSuffixPreset] = useState<'none' | 'diffuse' | 'normal'>('none')
  const [searchStr, setSearchStr] = useState('')
  const [replaceStr, setReplaceStr] = useState('')
  const [customPrefix, setCustomPrefix] = useState('')
  const [customSuffix, setCustomSuffix] = useState('')
  const [enableIndexing, setEnableIndexing] = useState(false)
  const [startIndex, setStartIndex] = useState(1)
  const [indexPadding, setIndexPadding] = useState(2)
  const [renaming, setRenaming] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)


  const getNewName = useCallback((oldName: string, index: number) => {
    const lastDot = oldName.lastIndexOf('.')
    const ext = lastDot !== -1 ? oldName.substring(lastDot) : ''
    let base = lastDot !== -1 ? oldName.substring(0, lastDot) : oldName

    // 1. Presets (Unity / Unreal prefixes)
    if (renamerPreset === 'texture') {
      base = 'T_' + base
    } else if (renamerPreset === 'mesh') {
      base = 'SM_' + base
    } else if (renamerPreset === 'audio') {
      base = 'A_' + base
    }

    // 2. Suffix presets
    if (renamerSuffixPreset === 'diffuse') {
      base = base + '_D'
    } else if (renamerSuffixPreset === 'normal') {
      base = base + '_N'
    }

    // 3. Search & Replace
    if (searchStr) {
      base = base.replaceAll(searchStr, replaceStr)
    }

    // 4. Custom Prefix / Suffix
    if (customPrefix) {
      base = customPrefix + base
    }
    if (customSuffix) {
      base = base + customSuffix
    }

    // 5. Automatic Number Indexing
    if (enableIndexing) {
      const paddedNum = String(index + startIndex).padStart(indexPadding, '0')
      base = base + '_' + paddedNum
    }

    return base + ext
  }, [renamerPreset, renamerSuffixPreset, searchStr, replaceStr, customPrefix, customSuffix, enableIndexing, startIndex, indexPadding])

  // Drag & Drop Event Handlers (stable useCallback refs)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) {
      // Electron ≥32: File.path no longer exists, resolve via preload webUtils
      const dropped = Array.from(e.dataTransfer.files).map(f => ({
        name: f.name,
        path: window.electronAPI.app.getPathForFile(f),
        status: 'pending' as const
      })).filter(f => f.path !== '')
      setFiles(prev => [...prev, ...dropped])
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files).map(f => ({
        name: f.name,
        path: window.electronAPI.app.getPathForFile(f),
        status: 'pending' as const
      })).filter(f => f.path !== '')
      setFiles(prev => [...prev, ...selected])
    }
  }, [])

  const handleApplyRename = useCallback(async () => {
    if (files.length === 0) return
    setRenaming(true)
    const list = files.map((f, idx) => {
      const newName = getNewName(f.name, idx)
      const platform = window.electronAPI.app.platform
      const separator = platform === 'win32' ? '\\' : '/'
      const lastSep = f.path.lastIndexOf(separator)
      const dir = lastSep !== -1 ? f.path.substring(0, lastSep) : ''
      const newPath = dir ? dir + separator + newName : newName
      return { oldPath: f.path, newPath }
    })

    try {
      const res = await window.electronAPI.gamedev.batchRename(list)
      if (res.success) {
        toast(`Successfully renamed ${res.renamedCount} assets!`, { type: 'success' })
        setFiles([])
      } else {
        toast(`Errors occurred during renaming.`, { type: 'error' })
        setFiles(prev => prev.map(f => {
          const matchErr = res.errors.find(e => e.oldPath === f.path)
          if (matchErr) {
            return { ...f, status: 'error', error: matchErr.error }
          }
          return { ...f, status: 'success' }
        }))
      }
    } catch (err) {
      console.error(err)
      toast('Failed to apply rename operations.', { type: 'error' })
    } finally {
      setRenaming(false)
    }
  }, [files, getNewName, toast])

  return {
    files,
    setFiles,
    renamerPreset,
    setRenamerPreset,
    renamerSuffixPreset,
    setRenamerSuffixPreset,
    searchStr,
    setSearchStr,
    replaceStr,
    setReplaceStr,
    customPrefix,
    setCustomPrefix,
    customSuffix,
    setCustomSuffix,
    enableIndexing,
    setEnableIndexing,
    startIndex,
    setStartIndex,
    indexPadding,
    setIndexPadding,
    renaming,
    isDragOver,
    getNewName,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
    handleApplyRename
  }
}

export type RenamerTool = ReturnType<typeof useRenamerTool>
