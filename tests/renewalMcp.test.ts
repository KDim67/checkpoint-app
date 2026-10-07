import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { closeDb, initDb } from '../src/main/db'
import { createRenewal, listRenewals } from '../src/main/renewals'
import { registerRenewalTools } from '../src/main/mcp/tools/renewals'
import { dueDay, isAllDay } from '../src/shared/dueDate'

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>

/** the two tools as the server would run them, without a server */
function tools(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  const fake = { registerTool: (name: string, _spec: unknown, handler: Handler) => { handlers[name] = handler } }
  registerRenewalTools(fake as unknown as McpServer)
  return handlers
}

const call = async (handler: Handler, args: Record<string, unknown>) => {
  const text = (await handler(args)).content[0].text
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { message: text }
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-renewal-mcp-'))
  initDb(dir)
})
afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('renewals over MCP', () => {
  it('creates one from its kind\'s template, a bare date as a whole day', async () => {
    const created = await call(tools().create_renewal, { context: 'work', title: 'Google Workspace', kind: 'subscription', expiresOn: '2027-05-03' })
    expect(created.created).toMatchObject({ kind: 'Subscription', renews: 'auto', cycle: 'Monthly', expiresOn: '2027-05-03' })
    const [stored] = listRenewals()
    expect(isAllDay(stored.meta.expiresAt ?? 0)).toBe(true)
    expect(dueDay(stored.meta.expiresAt ?? 0)).toStrictEqual({ year: 2027, month: 4, day: 3 })
    expect(stored.meta.fields.map(f => f.label)).toStrictEqual(['Cost', 'Card ends', 'Paid this cycle'])
  })

  it('refuses anything that looks like a key, so an agent cannot sync one everywhere', async () => {
    const answer = await call(tools().create_renewal, { context: 'work', title: 'OpenAI', notes: 'key: sk-proj-AbC123dEf456GhI789jKl012' })
    expect(answer.message).toMatch(/looks like a key/)
    expect(listRenewals()).toHaveLength(0)
  })

  it('says which kinds exist when given one that does not', async () => {
    const answer = await call(tools().create_renewal, { context: 'work', title: 'x', kind: 'spaceship' })
    expect(answer.message).toMatch(/There is no kind "spaceship"/)
  })

  it('never shows an agent the key hint', async () => {
    createRenewal({
      context: 'work',
      title: 'OpenAI key',
      meta: { kind: 'api_key', fields: [{ id: 'k', label: 'Key', type: 'keyHint', value: 'Ab12' }, { id: 'w', label: 'Where it lives', type: 'text', value: 'Vercel' }] }
    })
    const listed = await call(tools().list_renewals, {})
    const [entry] = listed.renewals as { fields: { label: string }[] }[]
    expect(entry.fields.map(f => f.label)).toStrictEqual(['Where it lives'])
    expect(JSON.stringify(listed)).not.toContain('Ab12')
  })
})
