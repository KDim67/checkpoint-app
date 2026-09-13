import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, GitBranch, AlertTriangle, Copy, Check, FileText, Settings, FolderGit } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import type { GitCommit, GitStatusResult } from '../../../shared/types'
import { COPIED_FEEDBACK_MS } from '../lib/timings'
import { readWorkspaceList } from '../lib/workspaceList'
import * as gitApi from '../data/git'

function formatGitDate(dateStr: string): string {
  if (!dateStr || dateStr === 'unknown') return dateStr
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}

export default function GitPanel() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)

  const [gitPath, setGitPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [isValidRepo, setIsValidRepo] = useState(false)
  const [gitInstalled, setGitInstalled] = useState(true)
  
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [copiedHash, setCopiedHash] = useState<string | null>(null)

  // 1. Fetch the gitPath associated with the active context from Settings
  const fetchContextConfig = useCallback(async () => {
    setLoading(true)
    try {
      const ctx = (await readWorkspaceList()).find(c => c.slug === activeWorkspace)
      setGitPath(ctx?.gitPath || null)
    } catch (err) {
      console.error('Failed to load contexts list in GitPanel:', err)
      setGitPath(null)
    } finally {
      setLoading(false)
    }
  }, [activeWorkspace])

  useEffect(() => {
    fetchContextConfig()
  }, [fetchContextConfig])

  // 2. Fetch Git status & log if the repo is valid
  const loadGitData = useCallback(async (path: string) => {
    setChecking(true)
    try {
      const isGitOk = await gitApi.checkRepo(path)
      setIsValidRepo(isGitOk)

      if (isGitOk) {
        const [statusRes, logRes] = await Promise.all([
          gitApi.getStatus(path),
          gitApi.getLog(path)
        ])
        setGitInstalled(statusRes.installed)
        setStatus(statusRes)
        setCommits(logRes)
      } else {
        setGitInstalled(false)
        setStatus(null)
        setCommits([])
      }
    } catch (err) {
      console.error('Failed to fetch Git info:', err)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (gitPath) {
      loadGitData(gitPath)
      const interval = setInterval(() => {
        loadGitData(gitPath)
      }, 30000)
      return () => clearInterval(interval)
    } else {
      setIsValidRepo(false)
      setStatus(null)
      setCommits([])
      return undefined
    }
  }, [gitPath, loadGitData])

  // Copy hash action
  const handleCopyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash)
      setCopiedHash(hash)
      setTimeout(() => setCopiedHash(null), COPIED_FEEDBACK_MS)
    } catch (err) {
      console.error('Failed to copy hash:', err)
    }
  }

  // Reload action
  const handleReload = () => {
    if (gitPath) {
      loadGitData(gitPath)
    } else {
      fetchContextConfig()
    }
  }

  // Get project name from path
  const getRepoName = (path: string) => {
    const parts = path.split(/[/\\]/)
    return parts.filter(Boolean).pop() || path
  }

  // Loading state
  if (loading) {
    return (
      <div style={{ flex: 1, padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', overflow: 'auto' }}>
        <div className="skeleton" style={{ height: '32px', width: '60%' }} />
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <div className="skeleton" style={{ height: '70px', flex: 1, borderRadius: 'var(--radius-md)' }} />
          <div className="skeleton" style={{ height: '70px', flex: 1, borderRadius: 'var(--radius-md)' }} />
        </div>
        <div className="col-mt">
          <div className="skeleton" style={{ height: '20px', width: '40%', marginBottom: 'var(--space-2)' }} />
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton" style={{ height: '56px', borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      </div>
    )
  }

  // Setup state: No Git repository configured
  if (!gitPath) {
    return (
      <div style={{
        flex: 1,
        padding: 'var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 'var(--space-4)',
        background: 'var(--color-surface-1)',
        height: '100%'
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'var(--color-surface-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-faint)',
          border: '1px solid var(--color-surface-offset)'
        }}>
          <FolderGit size={24} />
        </div>
        <div>
          <h4 style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            margin: '0 0 var(--space-1) 0'
          }}>
            No Git Integration
          </h4>
          <p style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            lineHeight: '1.5',
            margin: 0,
            maxWidth: '240px'
          }}>
            Map this workspace to a local Git repository in Settings to view branch status, uncommitted changes count, and commit history.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setView('settings')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontSize: 'var(--text-xs)',
            padding: 'var(--space-2) var(--space-4)',
            marginTop: 'var(--space-2)'
          }}
        >
          <Settings size={14} />
          Configure Path
        </button>
      </div>
    )
  }

  // Error state: Path configured but invalid git repository
  if (!isValidRepo) {
    return (
      <div style={{
        flex: 1,
        padding: 'var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 'var(--space-4)',
        background: 'var(--color-surface-1)',
        height: '100%'
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'rgba(239, 68, 68, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-error)',
          border: '1px solid rgba(239, 68, 68, 0.15)'
        }}>
          <AlertTriangle size={24} />
        </div>
        <div>
          <h4 style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            margin: '0 0 var(--space-1) 0'
          }}>
            Invalid Git Repository
          </h4>
          <p style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            lineHeight: '1.5',
            margin: '0 0 var(--space-3) 0',
            maxWidth: '240px'
          }}>
            {!gitInstalled 
              ? 'Git CLI is not installed or not available in the system PATH.'
              : `The folder configured for this workspace does not exist or is not a valid Git repository.`}
          </p>
          <div style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-faint)',
            wordBreak: 'break-word',
            wordWrap: 'break-word',
            maxWidth: '260px'
          }}>
            {gitPath}
          </div>
        </div>
        <div className="flex-gap-mt">
          <button
            className="btn-ghost"
            onClick={handleReload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              border: '1px solid var(--color-surface-offset)',
              padding: 'var(--space-2) var(--space-4)'
            }}
          >
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
            Retry
          </button>
          <button
            className="btn-primary"
            onClick={() => setView('settings')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              padding: 'var(--space-2) var(--space-4)'
            }}
          >
            <Settings size={12} />
            Edit Path
          </button>
        </div>
      </div>
    )
  }

  // Dashboard Active State
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      
      {/* Scrollable container */}
      <div style={{ flex: 1, padding: 'var(--space-4)', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        
        {/* Header summary info */}
        <div className="row-between">
          <div className="min-w-0">
            <h3 style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-text-base)',
              margin: 0,
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap'
            }}>
              {getRepoName(gitPath)}
            </h3>
            <span style={{
              fontSize: '10px',
              color: 'var(--color-text-faint)',
              fontFamily: 'var(--font-mono)',
              display: 'block',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap'
            }} title={gitPath}>
              {gitPath}
            </span>
          </div>
          <button
            className="btn-icon"
            onClick={handleReload}
            disabled={checking}
            style={{
              width: '28px',
              height: '28px',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-muted)'
            }}
            title="Refresh Git Status"
          >
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid-2">
          
          {/* Branch badge */}
          <div style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)', color: 'var(--color-text-muted)' }}>
              <GitBranch size={12} />
              <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Branch</span>
            </div>
            <span style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-secondary)',
              fontFamily: 'var(--font-mono)',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap'
            }}>
              {status?.branch || 'DETACHED'}
            </span>
          </div>

          {/* Uncommitted Changes badge */}
          <div style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)', color: 'var(--color-text-muted)' }}>
              <FileText size={12} />
              <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Changes</span>
            </div>
            <span style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              color: status && status.changesCount > 0 ? 'var(--color-warning)' : 'var(--color-success)'
            }}>
              {status && status.changesCount > 0 
                ? `${status.changesCount} file${status.changesCount !== 1 ? 's' : ''}` 
                : 'Clean'}
            </span>
          </div>
        </div>

        {/* Commit Log list */}
        <div className="col">
          <div style={{
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-muted)',
            fontWeight: 'var(--weight-semibold)',
            marginBottom: 'var(--space-1)'
          }}>
            Recent Commits
          </div>

          {commits.length === 0 ? (
            <div style={{
              padding: 'var(--space-4)',
              textAlign: 'center',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-faint)',
              background: 'var(--color-surface-2)',
              border: '1px dashed var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)'
            }}>
              No commits found.
            </div>
          ) : (
            <div className="col">
              {commits.map(commit => {
                const isCopied = copiedHash === commit.hash
                return (
                  <div
                    key={commit.hash}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-3)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)',
                      transition: 'border-color var(--duration-fast) var(--ease-default)'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(205, 241, 43, 0.25)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
                  >
                    {/* Hash & Copy Button */}
                    <div className="row-between">
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        fontWeight: 'var(--weight-semibold)',
                        color: 'var(--color-secondary)',
                        background: 'rgba(205, 241, 43, 0.08)',
                        padding: '2px 6px',
                        borderRadius: '4px'
                      }}>
                        {commit.hash}
                      </span>
                      
                      <button
                        onClick={() => handleCopyHash(commit.hash)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: isCopied ? 'var(--color-success)' : 'var(--color-text-faint)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '4px',
                          borderRadius: '4px',
                          transition: 'color var(--duration-fast)'
                        }}
                        title={isCopied ? 'Copied!' : 'Copy Commit Hash'}
                      >
                        {isCopied ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                    </div>

                    {/* Commit Message */}
                    <div style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-base)',
                      lineHeight: '1.4',
                      fontWeight: 'var(--weight-medium)',
                      wordBreak: 'break-word'
                    }}>
                      {commit.message}
                    </div>

                    {/* Commit Author & Date */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '10px',
                      color: 'var(--color-text-muted)'
                    }}>
                      <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                        {commit.author}
                      </span>
                      <span>
                        {formatGitDate(commit.date)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
