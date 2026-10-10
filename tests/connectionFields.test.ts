import { describe, expect, it } from 'vitest'
import { mergeField } from '../src/main/connections/reconcile'

describe('settling one field against what both sides last agreed', () => {
  it('takes the service\'s version when nothing was agreed yet, and records agreement when they already match', () => {
    expect(mergeField('Card', undefined, 'Task')).toBe('pull')
    expect(mergeField('Same', undefined, 'Same')).toBe('settle')
  })

  it('sends the card\'s change when only the card changed, and takes the service\'s when only it changed', () => {
    expect(mergeField('Edited here', 'Agreed', 'Agreed')).toBe('push')
    expect(mergeField('Agreed', 'Agreed', 'Edited there')).toBe('pull')
  })

  it('does nothing when neither changed, and records agreement when both changed the same way', () => {
    expect(mergeField('Agreed', 'Agreed', 'Agreed')).toBe('none')
    expect(mergeField('Both', 'Agreed', 'Both')).toBe('settle')
  })

  it('calls it a conflict when both changed differently', () => {
    expect(mergeField('Mine', 'Agreed', 'Theirs')).toBe('conflict')
  })

  it('treats an empty date as a value like any other', () => {
    expect(mergeField<number | null>(null, null, null)).toBe('none')
    expect(mergeField<number | null>(null, 5, 5)).toBe('push')
    expect(mergeField<number | null>(5, 5, null)).toBe('pull')
    expect(mergeField<number | null>(null, undefined, null)).toBe('settle')
  })
})
