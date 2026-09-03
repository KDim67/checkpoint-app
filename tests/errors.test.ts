import { describe, it, expect } from 'vitest'
import { errorMessage, isAbortError } from '../src/shared/errors'

describe('errorMessage', () => {
  it('reads a real Error', () => {
    expect(errorMessage(new Error('Disk full'))).toBe('Disk full')
  })

  it('reads a bare string, which rejected promises still throw', () => {
    expect(errorMessage('Timed out')).toBe('Timed out')
  })

  it('reads a message off a plain object', () => {
    // IPC and fetch failures often arrive shaped like an Error without being one.
    expect(errorMessage({ message: 'Connection refused' })).toBe('Connection refused')
  })

  it('does not show the user "[object Object]"', () => {
    // The old `err.message || String(err)` idiom did exactly that.
    expect(errorMessage({})).toBe('Something went wrong.')
    expect(errorMessage({ code: 42 })).toBe('Something went wrong.')
  })

  it('falls back for null, undefined and empty messages', () => {
    expect(errorMessage(null)).toBe('Something went wrong.')
    expect(errorMessage(undefined)).toBe('Something went wrong.')
    expect(errorMessage(new Error(''))).toBe('Something went wrong.')
    expect(errorMessage('   ')).toBe('Something went wrong.')
  })

  it('takes a caller-supplied fallback', () => {
    expect(errorMessage(null, 'Could not save.')).toBe('Could not save.')
  })

  it('stringifies primitives that stringify usefully', () => {
    expect(errorMessage(404)).toBe('404')
    expect(errorMessage(false)).toBe('false')
  })

  it('prefers a subclass message', () => {
    class HttpError extends Error {}
    expect(errorMessage(new HttpError('Not found'))).toBe('Not found')
  })
})

describe('isAbortError', () => {
  it('recognises a DOM abort', () => {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    expect(isAbortError(err)).toBe(true)
  })

  it('recognises one by its wording when the name is lost over IPC', () => {
    expect(isAbortError({ message: 'Request aborted by user' })).toBe(true)
  })

  it('does not call an ordinary failure an abort', () => {
    expect(isAbortError(new Error('Disk full'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})
