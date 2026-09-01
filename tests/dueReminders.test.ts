import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, getDb, createItem, setSetting, updateItem } from '../src/main/db'
import { checkDueItems } from '../src/main/dueReminders'
import { resetNotificationDedupe, POLICY_SETTING_KEY } from '../src/main/notificationService'
import { DEFAULT_POLICY } from '../src/shared/notificationPolicy'
import { shown } from './stubs/electron'

// The sweep runs every fifteen minutes over the same rows, so the behaviour that
// matters is what it declines to say a second time.

const DAY = 86_400_000
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-due-'))
  initDb(dir)
  shown.length = 0
  // Quiet hours default to off, but the window would otherwise depend on when
  // the suite happens to run.
  setSetting(POLICY_SETTING_KEY, { ...DEFAULT_POLICY, quietEnabled: false })
  resetNotificationDedupe()
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const item = (title: string, dueAt: number | null, status = 'open') =>
  createItem(getDb(), {
    type: 'task',
    context: 'test',
    title,
    body: '',
    status,
    priority: 2,
    position: 0,
    due_at: dueAt,
    metadata: '{}'
  } as Parameters<typeof createItem>[1])

describe('checkDueItems', () => {
  it('notifies about work that has come due', () => {
    item('Renew the certificate', Date.now() - 1000)
    expect(checkDueItems()).toBe(1)
    expect(shown[0].title).toBe('Renew the certificate')
  })

  it('says nothing about work that is not due yet', () => {
    item('Later', Date.now() + DAY)
    expect(checkDueItems()).toBe(0)
  })

  it('ignores items with no due date at all', () => {
    item('No date', null)
    expect(checkDueItems()).toBe(0)
  })

  it('ignores finished and archived work', () => {
    item('Done already', Date.now() - DAY, 'done')
    item('Archived', Date.now() - DAY, 'archived')
    expect(checkDueItems()).toBe(0)
  })

  it('does not repeat itself on the next sweep', () => {
    // The whole reason the notification layer keeps state: this runs every
    // fifteen minutes.
    item('Renew the certificate', Date.now() - 1000)
    expect(checkDueItems()).toBe(1)
    expect(checkDueItems()).toBe(0)
    expect(checkDueItems()).toBe(0)
    expect(shown).toHaveLength(1)
  })

  it('mentions it again the next day', () => {
    const now = Date.now()
    item('Renew the certificate', now - 1000)
    expect(checkDueItems(now)).toBe(1)
    expect(checkDueItems(now + DAY)).toBe(1)
    expect(shown).toHaveLength(2)
  })

  it('leaves very old overdue work alone', () => {
    // Otherwise the first run after this ships buries the user under months of
    // stale due dates at once.
    item('Ancient', Date.now() - 30 * DAY)
    expect(checkDueItems()).toBe(0)
  })

  it('says how overdue something is', () => {
    item('Two days late', Date.now() - 2 * DAY - 1000)
    checkDueItems()
    expect(shown[0].body).toContain('2 days overdue')
  })

  it('phrases something due right now differently', () => {
    item('Right now', Date.now() - 1000)
    checkDueItems()
    expect(shown[0].body).toContain('Due now')
  })

  it('stops mentioning an item once it is completed', () => {
    const created = item('Renew the certificate', Date.now() - 1000)
    checkDueItems()
    updateItem(getDb(), created.id, { status: 'done' })
    resetNotificationDedupe()

    expect(checkDueItems()).toBe(0)
  })

  it('respects the category switch', () => {
    setSetting(POLICY_SETTING_KEY, {
      ...DEFAULT_POLICY,
      categories: { ...DEFAULT_POLICY.categories, due: false }
    })
    item('Muted', Date.now() - 1000)
    expect(checkDueItems()).toBe(0)
  })

  it('respects the master switch', () => {
    setSetting(POLICY_SETTING_KEY, { ...DEFAULT_POLICY, enabled: false })
    item('Silenced', Date.now() - 1000)
    expect(checkDueItems()).toBe(0)
  })

  it('handles several due items in one sweep', () => {
    item('One', Date.now() - 1000)
    item('Two', Date.now() - 2000)
    item('Three', Date.now() - 3000)
    expect(checkDueItems()).toBe(3)
  })
})
