import { describe, it, expect } from 'vitest'
import { extractJson, repairJson, stripThink, isAbortError, isFatalError } from '../src/main/aiActions'

// Only the pure extraction/repair rungs of the ladder are exercised here. The
// attempt* functions themselves are one `client.chat.completions.create` call
// plus a call to extractJson, so testing them would test the OpenAI SDK.

describe('stripThink', () => {
  it('discards a reasoning model\'s think block', () => {
    expect(stripThink('<think>weighing options</think>\n{"a":1}')).toBe('{"a":1}')
  })

  it('keeps the prose of an unterminated think block rather than losing the answer', () => {
    // Streaming can truncate the closing tag. Dropping to end-of-string would
    // throw away the JSON that follows on endpoints which emit it anyway.
    expect(stripThink('<think>reasoning {"a":1}')).toBe('reasoning {"a":1}')
  })

  it('leaves ordinary text untouched', () => {
    expect(stripThink('  {"a":1}  ')).toBe('{"a":1}')
  })
})

describe('extractJson', () => {
  it('returns null for empty or whitespace-only output', () => {
    expect(extractJson('')).toBeNull()
    expect(extractJson('   ')).toBeNull()
  })

  it('parses a bare JSON object', () => {
    expect(extractJson('{"message":"hi","cards":[]}')).toEqual({ message: 'hi', cards: [] })
  })

  it('unwraps a fenced block, with or without a json tag', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Sure!\n```JSON\n{"a":1}\n```\nHope that helps.')).toEqual({ a: 1 })
  })

  it('digs the object out of surrounding prose', () => {
    expect(extractJson('Here is your board:\n{"a":1}\nLet me know!')).toEqual({ a: 1 })
  })

  it('accepts a top-level array when the model forgets the wrapper object', () => {
    expect(extractJson('[{"title":"a"},{"title":"b"}]')).toEqual([{ title: 'a' }, { title: 'b' }])
  })

  it('repairs the four malformations small models actually emit', () => {
    expect(extractJson('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] })
    expect(extractJson('{\n"a": 1\n"b": 2\n}')).toEqual({ a: 1, b: 2 })
    expect(extractJson('{\n // the title\n "a": 1\n}')).toEqual({ a: 1 })
    expect(extractJson('{\n /* block */ "a": 1\n}')).toEqual({ a: 1 })
  })

  it('strips a think block before looking for JSON', () => {
    expect(extractJson('<think>The user wants {"fake":1}</think>{"real":1}')).toEqual({ real: 1 })
  })

  it('returns null rather than a partial object when the response is truncated', () => {
    // A tiny model that runs out of tokens mid-array must be reported as a
    // failed generation so the ladder can retry, not accepted as an empty board.
    expect(extractJson('{"message":"ok","cards":[{"title":"a"')).toBeNull()
  })

  it('returns null for prose that contains no JSON at all', () => {
    expect(extractJson('I am sorry, I cannot help with that.')).toBeNull()
  })

  it('keeps a URL intact in well-formed output', () => {
    expect(extractJson('{"body":"see https://example.com/docs"}')).toEqual({
      body: 'see https://example.com/docs'
    })
  })

  // Known defect
  // repairJson strips `//` to end of line to remove JavaScript comments, but it
  // runs over the raw text with no notion of string boundaries. Any card body
  // containing a URL is truncated mid-string the moment the response also needs
  // repairing, so an otherwise recoverable generation is thrown away entirely.
  it('repairs a trailing comma even when a string value contains a URL', () => {
    expect(extractJson('{"body":"see https://example.com/docs",}')).toEqual({
      body: 'see https://example.com/docs'
    })
  })
})

describe('repairJson', () => {
  it('is a no-op on already valid JSON', () => {
    const valid = '{"a":1,"b":[1,2]}'
    expect(repairJson(valid)).toBe(valid)
  })
})

describe('error classification', () => {
  it('recognises every shape an aborted request arrives in', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true)
    expect(isAbortError({ status: 499 })).toBe(true)
    expect(isAbortError({ message: 'The operation was aborted' })).toBe(true)
    expect(isAbortError(new Error('connection refused'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })

  it('treats only auth and not-found as unfixable by another method', () => {
    // A 429 or a 500 may well succeed on the next rung, so the ladder must keep
    // going; a 401 or 404 will fail identically every time.
    for (const status of [401, 403, 404]) expect(isFatalError({ status })).toBe(true)
    for (const status of [400, 422, 429, 500, 503]) expect(isFatalError({ status })).toBe(false)
    expect(isFatalError(new Error('socket hang up'))).toBe(false)
    expect(isFatalError(null)).toBe(false)
  })
})
