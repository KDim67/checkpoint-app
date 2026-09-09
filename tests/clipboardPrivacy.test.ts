import { describe, it, expect } from 'vitest'
import { looksLikeSecret } from '../src/shared/clipboardPrivacy'

// A heuristic, and it is judged as one: what it must catch, what it must not
// eat, and where it is honestly expected to fail.

// Assembled at run time rather than written whole. A fixture that matches a
// credential shape closely enough to exercise the heuristic also matches the
// scanners that watch the repository, and an alert raised on a string that was
// never a secret teaches everyone to wave alerts through.
const shaped = (prefix: string, body: string): string => prefix + body

describe('credentials with a shape of their own', () => {
  const NAMED = {
    'an OpenAI key': shaped('sk-', 'abcdefghijklmnopqrstuvwxyz012345'),
    'a GitHub token': shaped('ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
    'a GitHub fine-grained token': shaped('github_pat_', '11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ'),
    'a Slack token': shaped('xoxb-', '1234567890-abcdefghijklm'),
    'an AWS access key id': shaped('AKIA', 'IOSFODNN7EXAMPLE'),
    'a Google API key': shaped('AIza', 'SyD-abcdefghijklmnopqrstuvwxyz01234'),
    'a JWT': shaped('eyJhbGciOiJIUzI1NiJ9.', 'eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk')
  }

  for (const [what, value] of Object.entries(NAMED)) {
    it(`never records ${what}`, () => {
      expect(looksLikeSecret(value)).toBe(true)
    })
  }

  it('never records a private key, even pasted with its surrounding text', () => {
    const pem = 'here it is\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----'
    expect(looksLikeSecret(pem)).toBe(true)
  })
})

describe('passwords out of a manager', () => {
  it.each([
    'Tr0ub4dor&3',
    'X7$kL9@mQ2!w',
    'aB3$dE6#gH9%',
    'p4ssW0rd!23'
  ])('does not record %s', password => {
    expect(looksLikeSecret(password)).toBe(true)
  })
})

describe('things people copy on purpose, which must survive', () => {
  it.each([
    ['a sentence', 'remember to check the build before the demo'],
    ['a command', 'npm run package -- --win'],
    ['a URL', 'https://example.com/a/path?q=1&token=abc'],
    ['a Windows path', 'C:\\Users\\someone\\Desktop\\notes.md'],
    ['a POSIX path', '/usr/local/share/checkpoint/config.json'],
    ['an email address', 'someone@example.com'],
    ['a git SHA', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'],
    ['an identifier', 'getUserByIdAndWorkspace'],
    ['a short word', 'hello'],
    ['a version', 'v1.2.0'],
    ['a phone number', '+44-7700-900123']
  ])('still records %s', (_what, value) => {
    expect(looksLikeSecret(value)).toBe(false)
  })

  it('still records a whole document, however mixed its characters', () => {
    const doc = 'A'.repeat(60) + ' ' + 'b1!'.repeat(60)
    expect(looksLikeSecret(doc)).toBe(false)
  })

  it('still records a long single-token blob that is past credential length', () => {
    // Beyond 200 characters it is data, not something typed into a login box.
    expect(looksLikeSecret('aB3$'.repeat(80))).toBe(false)
  })
})

describe('what it is honest about missing', () => {
  it('records a password made of one lower-case word and a digit', () => {
    // Two character classes. Indistinguishable from a username or a slug, and
    // dropping everything of this shape would gut the feature.
    expect(looksLikeSecret('hunter2')).toBe(false)
  })

  it('records a passphrase, because it has spaces in it', () => {
    expect(looksLikeSecret('correct horse battery staple')).toBe(false)
  })
})

describe('edges', () => {
  it('records nothing for an empty or blank copy', () => {
    expect(looksLikeSecret('')).toBe(false)
    expect(looksLikeSecret('   ')).toBe(false)
  })

  it('judges the trimmed text, so trailing whitespace cannot smuggle one past', () => {
    expect(looksLikeSecret('  Tr0ub4dor&3  ')).toBe(true)
  })
})
