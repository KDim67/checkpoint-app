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
    // Error-shaped objects from IPC and fetch
    expect(errorMessage({ message: 'Connection refused' })).toBe('Connection refused')
  })

  it('does not show the user "[object Object]"', () => {
    // what err.message || String(err) did
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

// WebRTC failures arrive as an Event with the text one level down
describe('errorMessage, an event carrying an error', () => {
  it('reads the error hanging off an event', () => {
    expect(errorMessage({ type: 'error', error: new Error('sctp-failure') })).toBe('sctp-failure')
  })

  it('reads one that is a plain object rather than an Error', () => {
    expect(errorMessage({ type: 'error', error: { message: 'User-Initiated Abort' } }))
      .toBe('User-Initiated Abort')
  })

  it('prefers the message the event carries itself', () => {
    expect(errorMessage({ message: 'outer', error: { message: 'inner' } })).toBe('outer')
  })

  it('falls back when the nested error says nothing either', () => {
    expect(errorMessage({ type: 'error', error: {} })).toBe('Something went wrong.')
    expect(errorMessage({ type: 'error', error: null })).toBe('Something went wrong.')
  })

  it('does not spin on a value that points at itself', () => {
    const loop: Record<string, unknown> = { type: 'error' }
    loop.error = loop
    expect(errorMessage(loop)).toBe('Something went wrong.')
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
