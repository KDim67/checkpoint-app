import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../src/shared/redactSecrets'

// what the app log and a bug report never carry, and what they must keep to stay useful

// built at runtime so repo secret scanners don't cry wolf
const shaped = (prefix: string, body: string): string => prefix + body

describe('credentials taken out of text', () => {
  const NAMED = {
    'an OpenAI key': shaped('sk-', 'abcdefghijklmnopqrstuvwxyz012345'),
    'a GitHub token': shaped('ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
    'a GitHub fine-grained token': shaped('github_pat_', '11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ'),
    'a Linear key': shaped('lin_api_', 'abcdefghijklmnopqrstuvwxyz0123456789abcd'),
    'an Atlassian API token': shaped('ATATT', '3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789=ABCD1234'),
    'a Notion integration secret': shaped('ntn_', '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'),
    'a Slack token': shaped('xoxb-', '1234567890-abcdefghijklm'),
    'an AWS access key id': shaped('AKIA', 'IOSFODNN7EXAMPLE'),
    'a Google API key': shaped('AIza', 'SyD-abcdefghijklmnopqrstuvwxyz01234'),
    'a JWT': shaped('eyJhbGciOiJIUzI1NiJ9.', 'eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'a Todoist key': shaped('0123456789abcdef', '0123456789abcdef01234567'),
    'a 32-character hex key': shaped('9f86d081884c7d65', '9a2feaa0c55ad015')
  }

  for (const [what, value] of Object.entries(NAMED)) {
    it(`takes out ${what} wherever it sits in a line`, () => {
      const out = redactSecrets(`[connections] refused key ${value}, check it`)
      expect(out).toBe('[connections] refused key [redacted], check it')
    })
  }

  it('takes out a private key block whole', () => {
    const pem = 'loaded -----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY----- done'
    expect(redactSecrets(pem)).toBe('loaded [private key redacted] done')
  })

  it('takes the query string off a link, where keys travel, and the user and password out of one', () => {
    expect(redactSecrets('GET https://api.example.com/v1/items?token=abc&page=2 failed'))
      .toBe('GET https://api.example.com/v1/items?[query removed] failed')
    expect(redactSecrets('connect to https://sam:hunter2@relay.example.com/room'))
      .toBe('connect to https://[redacted]@relay.example.com/room')
  })

  it('takes out bearer and basic credentials and named secrets in any common form', () => {
    expect(redactSecrets('Authorization: Bearer abcdefgh12345678')).toBe('Authorization: Bearer [redacted]')
    expect(redactSecrets('Authorization: Basic c2FtOmh1bnRlcjI=')).toBe('Authorization: Basic [redacted]')
    expect(redactSecrets('headers {"Authorization":"token abcdefgh12345678"}')).toBe('headers {"Authorization":"token [redacted]"}')
    expect(redactSecrets('{"apiKey": "k-123", "page": 2}')).toBe('{"apiKey": "[redacted]", "page": 2}')
    expect(redactSecrets('x-api-key=k-123; password=hunter2 client_secret: abc')).toBe('x-api-key=[redacted]; password=[redacted] client_secret: [redacted]')
  })
})

describe('what a report needs, left alone', () => {
  it('keeps a packaged stack trace whole, paths, chunk names and positions', () => {
    const stack = [
      'TypeError: Cannot read properties of undefined (reading \'id\')',
      '    at saveCard (file:///~/AppData/Local/Programs/checkpoint-app/resources/app.asar/out/renderer/assets/KanbanView-DpVFIYGh.js:12:3451)',
      '    at async Promise.all (index 0)'
    ].join('\n')
    expect(redactSecrets(stack)).toBe(stack)
  })

  it('keeps timestamps, item ids, windows paths and plain words about keys', () => {
    const lines = [
      '2026-10-11T10:00:00.000Z error [db] Failed to save item 3f2b1c4e-9a7d-4b2e-8c1f-0e6d5a4b3c2a',
      'C:\\Users\\~\\AppData\\Local\\checkpoint-app-updater\\pending\\checkpoint-app-1.2.0-win-x64.exe',
      '[sync] the relay password is wrong, so the token expired and Authorization failed',
      'SQLITE_CONSTRAINT: UNIQUE constraint failed: items.id'
    ].join('\n')
    expect(redactSecrets(lines)).toBe(lines)
  })

  it('keeps a link that carries no query string', () => {
    expect(redactSecrets('could not reach https://api.todoist.com/api/v1/tasks')).toBe('could not reach https://api.todoist.com/api/v1/tasks')
  })
})
