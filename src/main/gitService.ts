import { exec } from 'child_process'
import util from 'util'
import fs from 'fs'
import type { GitCommit, GitStatusResult } from '../shared/types'

const execPromise = util.promisify(exec)

/**
 * Checks if Git is installed on the user's machine and in their PATH.
 */
export async function isGitInstalled(): Promise<boolean> {
  try {
    await execPromise('git --version')
    return true
  } catch {
    return false
  }
}

/**
 * Checks if the provided directory path exists and is a valid Git repository.
 */
export async function checkRepo(repoPath: string): Promise<boolean> {
  if (!repoPath || !fs.existsSync(repoPath)) {
    return false
  }
  try {
    const { stdout } = await execPromise('git rev-parse --is-inside-work-tree', { cwd: repoPath })
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Retrieves the current branch and uncommitted changes count.
 */
export async function getGitStatus(repoPath: string): Promise<GitStatusResult> {
  const installed = await isGitInstalled()
  if (!installed) {
    return { branch: 'unknown', changesCount: 0, installed: false }
  }

  if (!repoPath || !fs.existsSync(repoPath)) {
    return { branch: 'unknown', changesCount: 0, installed: true }
  }

  try {
    // Run branch name query
    const branchRes = await execPromise('git branch --show-current', { cwd: repoPath })
    const branch = branchRes.stdout.trim() || 'DETACHED'

    // Run porcelain status to count changes
    const statusRes = await execPromise('git status --porcelain', { cwd: repoPath })
    const changesCount = statusRes.stdout
      .split('\n')
      .filter(line => line.trim().length > 0)
      .length

    return { branch, changesCount, installed: true }
  } catch (err) {
    console.error(`Failed to get git status for "${repoPath}":`, err)
    return { branch: 'unknown', changesCount: 0, installed: true }
  }
}

/**
 * Retrieves the last 10 commits.
 */
export async function getGitLog(repoPath: string): Promise<GitCommit[]> {
  const installed = await isGitInstalled()
  if (!installed || !repoPath || !fs.existsSync(repoPath)) {
    return []
  }

  try {
    // Query last 10 commits. Format: hash<tab>subject<tab>author_name<tab>author_date_iso
    const { stdout } = await execPromise(
      'git log -n 10 --pretty=format:"%h%x09%s%x09%an%x09%aI"',
      { cwd: repoPath }
    )

    const lines = stdout.split('\n').filter(line => line.trim().length > 0)

    return lines.map(line => {
      const [hash, message, author, date] = line.split('\t')
      return {
        hash: hash || 'unknown',
        message: message || 'No commit message',
        author: author || 'unknown',
        date: date || 'unknown'
      }
    })
  } catch (err) {
    console.error(`Failed to read git log for "${repoPath}":`, err)
    return []
  }
}
