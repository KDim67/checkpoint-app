// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { RenewalRecord, RenewalSnapshot } from '../src/shared/renewalApi'

/** an in-memory main process: same normalising and renewing, no database */
const fake = vi.hoisted(() => ({
  records: [] as RenewalRecord[],
  calls: { create: [] as unknown[], update: [] as unknown[], restore: [] as RenewalSnapshot[], remove: [] as string[] }
}))

vi.mock('../src/renderer/src/data/renewals', async () => {
  const { normalizeRenewal, advancePast, renewTo } = await import('../src/shared/renewal')
  const { normalizeKinds } = await import('../src/shared/renewalKinds')
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  const snapshotOf = (r: RenewalRecord): RenewalSnapshot =>
    ({ id: r.id, context: r.context, title: r.title, body: r.body, status: r.status, metadata: JSON.stringify(r.meta), createdAt: r.createdAt })
  const find = (id: string) => fake.records.find(r => r.id === id) as RenewalRecord
  const replace = (next: RenewalRecord) => { fake.records = fake.records.map(r => (r.id === next.id ? next : r)); return next }
  let n = 0
  return {
    list: vi.fn(async () => ok([...fake.records])),
    kinds: vi.fn(async () => ok(normalizeKinds(null))),
    create: vi.fn(async (input: { context: string; title: string; body?: string; meta: unknown }) => {
      fake.calls.create.push(input)
      const record: RenewalRecord = {
        id: `new-${++n}`, context: input.context, title: input.title, body: input.body ?? '', status: 'active',
        createdAt: 1, updatedAt: 1, meta: normalizeRenewal(input.meta).meta, dropped: 0, snoozedUntil: null, lookupState: null
      }
      fake.records = [...fake.records, record]
      return ok(record)
    }),
    update: vi.fn(async (id: string, patch: { title?: string; body?: string; status?: 'active' | 'cancelled'; meta?: unknown }) => {
      fake.calls.update.push({ id, patch })
      const r = find(id)
      return ok(replace({ ...r, ...patch, meta: patch.meta ? normalizeRenewal(patch.meta).meta : r.meta, updatedAt: r.updatedAt + 1 } as RenewalRecord))
    }),
    renewed: vi.fn(async (id: string) => {
      const r = find(id)
      const to = advancePast(r.meta.expiresAt as number, r.meta.cycle, r.meta.anchorDay, Date.now()) as number
      const previous = snapshotOf(r)
      return ok({ record: replace({ ...r, meta: renewTo(r.meta, to, 'you', Date.now(), true), updatedAt: r.updatedAt + 1 }), previous })
    }),
    restore: vi.fn(async (snapshot: RenewalSnapshot) => {
      fake.calls.restore.push(snapshot)
      const record: RenewalRecord = {
        id: snapshot.id, context: snapshot.context, title: snapshot.title, body: snapshot.body,
        status: snapshot.status === 'cancelled' ? 'cancelled' : 'active', createdAt: snapshot.createdAt, updatedAt: 99,
        meta: normalizeRenewal(snapshot.metadata).meta, dropped: 0, snoozedUntil: null, lookupState: null
      }
      fake.records = fake.records.some(r => r.id === record.id) ? fake.records.map(r => (r.id === record.id ? record : r)) : [...fake.records, record]
      return ok(record)
    }),
    remove: vi.fn(async (id: string) => {
      fake.calls.remove.push(id)
      const r = find(id)
      fake.records = fake.records.filter(x => x.id !== id)
      return ok(snapshotOf(r))
    }),
    snooze: vi.fn(async (id: string) => ok(find(id))),
    checkNow: vi.fn(async (id: string) => ok(find(id))),
    saveKinds: vi.fn(async (kinds: unknown) => ok(normalizeKinds(kinds))),
    renameField: vi.fn(async () => ok({ kinds: normalizeKinds(null), renamed: 0 })),
    fieldUses: vi.fn(async () => ok(0))
  }
})
vi.mock('../src/renderer/src/data/mcp', () => ({ onDataChanged: () => () => {} }))
vi.mock('../src/renderer/src/data/app', () => ({ openExternal: vi.fn(async () => {}) }))
vi.mock('../src/renderer/src/lib/settings', () => ({
  getEnumSetting: vi.fn(async (_k: string, _allowed: string[], fallback: string) => fallback),
  setStringSetting: vi.fn(async () => {})
}))

import RenewalsView from '../src/renderer/src/components/RenewalsView'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'
import { useAppStore } from '../src/renderer/src/store/appStore'
import { normalizeRenewal } from '../src/shared/renewal'
import { allDay, dueDay, isAllDay, localDayOf } from '../src/shared/dueDate'

const today = localDayOf(Date.now())
const inDays = (n: number): number => allDay({ ...today, day: today.day + n })

function record(title: string, meta: object, extra: Partial<RenewalRecord> = {}): RenewalRecord {
  return {
    id: title, context: 'work', title, body: '', status: 'active', createdAt: 1, updatedAt: 1,
    meta: normalizeRenewal(meta).meta, dropped: 0, snoozedUntil: null, lookupState: null, ...extra
  }
}

async function show(): Promise<void> {
  await act(async () => {
    render(<ToastProvider><RenewalsView /></ToastProvider>)
  })
}

beforeEach(() => {
  fake.records = []
  fake.calls = { create: [], update: [], restore: [], remove: [] }
  useAppStore.setState({ activeWorkspace: 'work', availableWorkspaces: ['work'], pendingCreate: null, pendingRenewalId: null })
})
afterEach(cleanup)

describe('the Renewals screen', () => {
  it('groups by how soon, soonest first, with cancelled ones folded away', async () => {
    fake.records = [
      record('Later key', { expiresAt: inDays(90) }),
      record('Lapsed domain', { expiresAt: inDays(-2) }),
      record('Soon sub', { expiresAt: inDays(5) }),
      record('Sooner sub', { expiresAt: inDays(2) }),
      record('Old plan', { expiresAt: inDays(10) }, { status: 'cancelled' })
    ]
    await show()
    const titles = (label: string) =>
      within(screen.getByRole('region', { name: label })).queryAllByRole('listitem').map(li => li.getAttribute('aria-label')?.split(',')[0])
    expect(titles('Expired')).toStrictEqual(['Lapsed domain'])
    expect(titles('Next 30 days')).toStrictEqual(['Sooner sub', 'Soon sub'])
    expect(titles('Later')).toStrictEqual(['Later key'])
    expect(titles('Cancelled')).toStrictEqual([])
    fireEvent.click(screen.getByRole('button', { name: /Cancelled · 1/ }))
    expect(titles('Cancelled')).toStrictEqual(['Old plan'])
  })

  it('says what it is and offers a start when nothing is tracked', async () => {
    await show()
    expect(screen.getByText('Nothing expiring is tracked yet')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Domain' })) })
    expect(fake.calls.create).toHaveLength(1)
    expect(screen.getByRole('complementary', { name: 'Edit New domain' })).toBeTruthy()
  })

  it('adds from typed words, a day said without a time as that whole day, and opens it', async () => {
    fake.records = [record('Existing', { expiresAt: inDays(40) })]
    await show()
    const box = screen.getByLabelText('New renewal')
    fireEvent.change(box, { target: { value: 'openai key 20 jan' } })
    expect(screen.getByText(/^API key · /)).toBeTruthy()
    await act(async () => { fireEvent.submit(box.closest('form') as HTMLFormElement) })

    const created = fake.calls.create[0] as { title: string; meta: { kind: string; expiresAt: number } }
    expect(created.title).toBe('openai key')
    expect(created.meta.kind).toBe('api_key')
    expect(isAllDay(created.meta.expiresAt)).toBe(true)
    expect(dueDay(created.meta.expiresAt).month).toBe(0)
    expect(screen.getByRole('complementary', { name: 'Edit openai key' })).toBeTruthy()
  })

  it('moves the date on with Renewed and puts it back with Undo', async () => {
    fake.records = [record('Workspace', { expiresAt: inDays(-1), cycle: { every: 1, unit: 'month' } })]
    await show()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Renewed/ })) })
    expect(screen.getByText(/^Renewed until /)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })) })
    expect(fake.calls.restore).toHaveLength(1)
    expect(normalizeRenewal(fake.calls.restore[0].metadata).meta.expiresAt).toBe(inDays(-1))
  })

  it('deletes from the keyboard, and Undo brings it back', async () => {
    fake.records = [record('A', { expiresAt: inDays(3) }), record('B', { expiresAt: inDays(4) })]
    await show()
    const first = screen.getAllByRole('listitem')[0]
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^B,/)
    await act(async () => { fireEvent.keyDown(document.activeElement as Element, { key: 'Delete' }) })
    expect(fake.calls.remove).toStrictEqual(['B'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })) })
    expect(fake.calls.restore[0].id).toBe('B')
  })
})

describe('the editor', () => {
  it('spots a key pasted into the notes and cuts it down to a hint before it syncs', async () => {
    fake.records = [record('OpenAI', { kind: 'api_key', expiresAt: inDays(20) })]
    await show()
    fireEvent.click(screen.getAllByRole('listitem')[0])
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'prod key sk-proj-AbC123dEf456GhI789jKl012 in vercel' } })
    expect(screen.getByRole('alert').textContent).toMatch(/This looks like a key/)
    fireEvent.click(screen.getByRole('button', { name: 'Keep only the last 4' }))
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('prod key in vercel')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    const saved = fake.calls.update[0] as { patch: { body: string; meta: { fields: { type: string; value: string }[] } } }
    expect(saved.patch.body).toBe('prod key in vercel')
    expect(saved.patch.meta.fields.find(f => f.type === 'keyHint')?.value).toBe('l012')
  })

  it('keeps only the last four of a key typed into a hint, and says so', async () => {
    fake.records = [record('Key', { kind: 'api_key', fields: [{ id: 'h', label: 'Key', type: 'keyHint', value: '' }] })]
    await show()
    fireEvent.click(screen.getAllByRole('listitem')[0])
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'ghp_abcdefghijklmnopqrstuvwxyz0123' } })
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('0123')
    expect(screen.getByText(/Only the last 4 characters were kept/)).toBeTruthy()
  })

  it('says when fields could not be read', async () => {
    fake.records = [record('Damaged', {}, { dropped: 2 })]
    await show()
    fireEvent.click(screen.getAllByRole('listitem')[0])
    expect(screen.getByText('2 fields couldn’t be read and were left out.')).toBeTruthy()
  })

  it('saves before closing, and stays open when the save fails', async () => {
    fake.records = [record('Plan', { expiresAt: inDays(20) })]
    await show()
    fireEvent.click(screen.getAllByRole('listitem')[0])
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'ask Maria' } })
    const api = await import('../src/renderer/src/data/renewals')
    vi.mocked(api.update).mockResolvedValueOnce({ ok: false, reason: 'disk full' })
    await act(async () => { fireEvent.click(screen.getByTitle('Save and close')) })
    expect(screen.getByRole('complementary', { name: 'Edit Plan' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByTitle('Save and close')) })
    expect(screen.queryByRole('complementary', { name: 'Edit Plan' })).toBeNull()
  })
})
