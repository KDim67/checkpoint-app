import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearClipboardHistory,
  closeDb,
  createClipboardSnippet,
  deleteClipboardItem,
  getClipboardHistory,
  initDb,
  recordClipboardCopy,
  restoreClipboardItem
} from '../src/main/db'
import { SyncService } from '../src/main/syncService'

// two machines, each its own database; a copy deleted on one must not come back from the other

const dirs: Record<'A' | 'B', string> = { A: '', B: '' }
const service = new SyncService()

const on = (machine: 'A' | 'B'): void => {
  closeDb()
  initDb(dirs[machine])
}

/** one session the way the protocol runs it: the host's state lands on the client first */
function sync(host: 'A' | 'B', client: 'A' | 'B'): void {
  on(host)
  const fromHost = service.getDatabasePayload()
  on(client)
  service.applyDatabasePayload(fromHost)
  const fromClient = service.getDatabasePayload()
  on(host)
  service.applyDatabasePayload(fromClient)
}

const contents = (): string[] => getClipboardHistory().map(c => c.content).sort()
const idOf = (content: string): string => getClipboardHistory().find(c => c.content === content)!.id

beforeEach(() => {
  dirs.A = mkdtempSync(join(tmpdir(), 'checkpoint-machine-a-'))
  dirs.B = mkdtempSync(join(tmpdir(), 'checkpoint-machine-b-'))
  on('A')
  recordClipboardCopy('a password that slipped through')
  recordClipboardCopy('meeting notes for thursday')
  createClipboardSnippet('a pinned snippet', 'kept')
  sync('A', 'B')
  on('B')
  expect(contents()).toEqual(['a password that slipped through', 'a pinned snippet', 'meeting notes for thursday'])
})

afterEach(() => {
  closeDb()
  rmSync(dirs.A, { recursive: true, force: true })
  rmSync(dirs.B, { recursive: true, force: true })
})

describe('deleting clipboard copies across computers', () => {
  it('deletes a copy on the other computer, and it stays deleted after more syncs', () => {
    on('A')
    deleteClipboardItem(idOf('a password that slipped through'))
    sync('A', 'B')
    sync('B', 'A')
    for (const machine of ['A', 'B'] as const) {
      on(machine)
      expect(contents()).toEqual(['a pinned snippet', 'meeting notes for thursday'])
    }
  })

  it('does not take a deleted copy back from a computer that synced before hearing of the delete', () => {
    on('A')
    deleteClipboardItem(idOf('a password that slipped through'))
    // B is the host this time, offering the copy A just deleted
    sync('B', 'A')
    on('A')
    expect(contents()).not.toContain('a password that slipped through')
  })

  it('clears history on every computer and leaves pinned snippets', () => {
    on('B')
    clearClipboardHistory()
    sync('B', 'A')
    for (const machine of ['A', 'B'] as const) {
      on(machine)
      expect(contents()).toEqual(['a pinned snippet'])
    }
  })

  it('syncs a copy brought back with undo after its delete', () => {
    on('A')
    deleteClipboardItem(idOf('meeting notes for thursday'))
    restoreClipboardItem('meeting notes for thursday', false, null)
    sync('A', 'B')
    for (const machine of ['A', 'B'] as const) {
      on(machine)
      expect(contents()).toContain('meeting notes for thursday')
    }
  })
})
