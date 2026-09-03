import { describe, it, expect } from 'vitest'
import {
  formatSamplesForPrompt,
  MAX_EMAIL_SAMPLES,
  normalizeEmailSamples,
  parseEmailSamples,
  type EmailSample
} from '../src/shared/emailSamples'

const sample = (over: Partial<EmailSample> = {}): EmailSample => ({
  id: 's1',
  title: 'Follow-up',
  body: 'Thanks for the call.',
  ...over
})

describe('normalizeEmailSamples', () => {
  it('keeps well-formed rows unchanged', () => {
    const rows = [sample()]
    expect(normalizeEmailSamples(rows)).toEqual(rows)
  })

  it('drops rows with no body, since an empty sample teaches nothing', () => {
    expect(normalizeEmailSamples([sample({ body: '' }), sample({ body: '   ' })])).toEqual([])
  })

  it('fills in a missing id and title rather than dropping the row', () => {
    const [only] = normalizeEmailSamples([{ body: 'Hello there.' }])
    expect(only.body).toBe('Hello there.')
    expect(only.id).toBeTruthy()
    expect(only.title).toBeTruthy()
  })

  it('survives junk instead of throwing', () => {
    expect(normalizeEmailSamples(null)).toEqual([])
    expect(normalizeEmailSamples('nope')).toEqual([])
    expect(normalizeEmailSamples([null, 42, 'x'])).toEqual([])
  })

  it('caps at the number the settings UI allows', () => {
    const many = Array.from({ length: 12 }, (_, i) => sample({ id: `s${i}`, body: `Body ${i}` }))
    expect(normalizeEmailSamples(many)).toHaveLength(MAX_EMAIL_SAMPLES)
  })
})

describe('parseEmailSamples', () => {
  it('reads the stored JSON form', () => {
    expect(parseEmailSamples(JSON.stringify([sample()]))).toEqual([sample()])
  })

  it('treats an absent or broken setting as no samples', () => {
    expect(parseEmailSamples(null)).toEqual([])
    expect(parseEmailSamples('')).toEqual([])
    expect(parseEmailSamples('{not json')).toEqual([])
  })
})

describe('formatSamplesForPrompt', () => {
  it('numbers the samples and labels them by title', () => {
    const text = formatSamplesForPrompt([
      sample({ title: 'Follow-up', body: 'A' }),
      sample({ title: 'Intro', body: 'B' })
    ])
    expect(text).toBe('--- Sample 1 (Follow-up) ---\nA\n\n--- Sample 2 (Intro) ---\nB')
  })

  it('returns nothing to inject when every sample is empty', () => {
    expect(formatSamplesForPrompt([sample({ body: '' })])).toBe('')
  })
})
