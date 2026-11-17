import { describe, expect, it } from 'vitest'
import { isCustomizerIgnoredPath } from '../src/main/customizer'

describe('customizer file watcher path filtering', () => {
  it('ignores media, cache, notes, and backup directories on Windows', () => {
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\media')).toBe(true)
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\cache')).toBe(true)
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\notes')).toBe(true)
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\backups')).toBe(true)
  })

  it('ignores files inside media, cache, notes, and backup directories on Windows', () => {
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\media\\test_map.jpg')).toBe(true)
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\cache\\preview_123.webp')).toBe(true)
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\notes\\meeting.md')).toBe(true)
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\backups\\snapshot.zip')).toBe(true)
  })

  it('ignores relative media and cache paths', () => {
    expect(isCustomizerIgnoredPath('media')).toBe(true)
    expect(isCustomizerIgnoredPath('media\\test_map.jpg')).toBe(true)
    expect(isCustomizerIgnoredPath('cache/thumbnail.png')).toBe(true)
    expect(isCustomizerIgnoredPath('notes/test.txt')).toBe(true)
  })

  it('ignores POSIX equivalents of locked/volatile directories', () => {
    expect(isCustomizerIgnoredPath('/home/user/.config/checkpoint/media')).toBe(true)
    expect(isCustomizerIgnoredPath('/home/user/.config/checkpoint/media/test_map.jpg')).toBe(true)
    expect(isCustomizerIgnoredPath('/home/user/.config/checkpoint/cache/img.png')).toBe(true)
  })

  it('ignores hidden/dot files and directories', () => {
    expect(isCustomizerIgnoredPath('.git')).toBe(true)
    expect(isCustomizerIgnoredPath('.DS_Store')).toBe(true)
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\.git\\HEAD')).toBe(true)
  })

  it('allows theme.css and plugin javascript files', () => {
    expect(isCustomizerIgnoredPath('theme.css')).toBe(false)
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\theme.css')).toBe(false)
    expect(isCustomizerIgnoredPath('/home/user/.config/checkpoint/theme.css')).toBe(false)
    expect(isCustomizerIgnoredPath('plugins\\daily-summary.js')).toBe(false)
    expect(isCustomizerIgnoredPath('C:\\Users\\user\\.config\\checkpoint\\plugins\\webhook.js')).toBe(false)
    expect(isCustomizerIgnoredPath('/home/user/.config/checkpoint/plugins/timer.js')).toBe(false)
  })
})
