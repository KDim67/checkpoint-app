import { describe, it, expect } from 'vitest'
import { BG_STYLES, getBoardBackgroundStyle } from '../src/renderer/src/components/kanban/boardBackground'

describe('getBoardBackgroundStyle', () => {
  it('paints the default preset when nothing is stored', () => {
    expect(getBoardBackgroundStyle('')).toBe(BG_STYLES.default)
  })

  it('looks a preset up by name', () => {
    expect(getBoardBackgroundStyle('ocean')).toBe(BG_STYLES.ocean)
  })

  it('covers the board with a linked or uploaded image', () => {
    expect(getBoardBackgroundStyle('https://example.com/a.png')).toBe('url("https://example.com/a.png") center / cover no-repeat')
    expect(getBoardBackgroundStyle('file:///C:/art/a.png')).toBe('url("file:///C:/art/a.png") center / cover no-repeat')
    expect(getBoardBackgroundStyle('data:image/png;base64,AAAA')).toBe('url("data:image/png;base64,AAAA") center / cover no-repeat')
  })

  it('leaves a value that is already a url() alone', () => {
    expect(getBoardBackgroundStyle('url("x.png")')).toBe('url("x.png")')
  })

  it('passes a colour or a gradient through', () => {
    expect(getBoardBackgroundStyle('#1e293b')).toBe('#1e293b')
    expect(getBoardBackgroundStyle('linear-gradient(90deg, #000 0%, #fff 100%)')).toBe('linear-gradient(90deg, #000 0%, #fff 100%)')
  })

  // free text that gets saved, so inherited names aren't presets
  it('does not take an inherited property name for a preset', () => {
    expect(getBoardBackgroundStyle('toString')).toBe('toString')
    expect(getBoardBackgroundStyle('constructor')).toBe('constructor')
  })
})
