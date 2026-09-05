import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PREVIEW_WIDTHS,
  previewWidthFor,
  previewFilename,
  ensurePreview,
  isPreviewOf,
  warmPreviews,
  EAGER_WIDTHS
} from '../src/main/mediaPreview'

describe('choosing a preview width', () => {
  it('rounds up to the smallest width that covers what was asked for', () => {
    expect(previewWidthFor(1)).toBe(480)
    expect(previewWidthFor(480)).toBe(480)
    expect(previewWidthFor(481)).toBe(960)
    expect(previewWidthFor(1500)).toBe(1920)
  })

  it('caps at the largest rather than growing without limit', () => {
    // Otherwise a wall item resized to something absurd would cache a copy
    // per pixel width and defeat the point of the ladder.
    expect(previewWidthFor(99999)).toBe(PREVIEW_WIDTHS[PREVIEW_WIDTHS.length - 1])
  })

  it('is a short ladder, so one image cannot fill the cache', () => {
    expect(PREVIEW_WIDTHS.length).toBeLessThanOrEqual(4)
    expect([...PREVIEW_WIDTHS].sort((a, b) => a - b)).toEqual(PREVIEW_WIDTHS)
  })
})

describe('naming a cached copy', () => {
  it('keeps the width in the name so two sizes do not collide', () => {
    expect(previewFilename('abc.png', 480)).toBe('abc@480.png')
    expect(previewFilename('abc.png', 960)).toBe('abc@960.png')
  })

  it('re-encodes as JPEG only when the source had no alpha to lose', () => {
    expect(previewFilename('photo.jpg', 960)).toBe('photo@960.jpg')
    expect(previewFilename('photo.JPEG', 960)).toBe('photo@960.jpg')
    // PNG, WebP and GIF can all carry transparency; flattening it to black
    // would be a visible bug, so they stay PNG.
    expect(previewFilename('logo.png', 960)).toBe('logo@960.png')
    expect(previewFilename('logo.webp', 960)).toBe('logo@960.png')
    expect(previewFilename('anim.gif', 960)).toBe('anim@960.png')
  })
})

describe('generating a preview', () => {
  it('declines a file that is not there', () => {
    expect(ensurePreview(join(tmpdir(), 'checkpoint-not-here.png'), 960)).toBeNull()
  })

  it('declines anything it cannot decode, so the original is served', () => {
    // Null here means "serve the original", not "something went wrong".
    // The electron stub reports every image as empty, so what this pins down
    // is the empty-image branch rather than Chromium's real SVG support.
    const dir = mkdtempSync(join(tmpdir(), 'checkpoint-preview-'))
    try {
      const svg = join(dir, 'diagram.svg')
      writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>')
      expect(ensurePreview(svg, 960)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('recognising a cached copy', () => {
  it('matches every width made from the same source', () => {
    expect(isPreviewOf('abc.png', 'abc@480.png')).toBe(true)
    expect(isPreviewOf('abc.png', 'abc@1920.png')).toBe(true)
    expect(isPreviewOf('photo.jpg', 'photo@960.jpg')).toBe(true)
  })

  it('does not match a different file that starts the same way', () => {
    // Media filenames are UUIDs, but a prefix match would still be a bug
    // waiting for the day they are not.
    expect(isPreviewOf('abc.png', 'abcd@480.png')).toBe(false)
    expect(isPreviewOf('abc.png', 'ab@480.png')).toBe(false)
  })

  it('does not match a file that merely has an @ in its name', () => {
    expect(isPreviewOf('abc.png', 'abc@notawidth.png')).toBe(false)
    expect(isPreviewOf('abc.png', 'abc@.png')).toBe(false)
    expect(isPreviewOf('abc.png', 'abc.png')).toBe(false)
  })
})

describe('warming previews when an image arrives', () => {
  it('builds the widths a new image is actually asked for', () => {
    // The Wall requests twice an item's box, and an item starts at 280 wide.
    expect(EAGER_WIDTHS).toContain(previewWidthFor(280 * 2))
  })

  it('leaves the largest for someone who actually enlarges one', () => {
    // 1920 costs as much as the other two together and most images never
    // reach a box that wants it.
    expect(EAGER_WIDTHS).not.toContain(1920)
    expect(PREVIEW_WIDTHS).toContain(1920)
  })

  it('only warms widths the ladder can serve', () => {
    for (const width of EAGER_WIDTHS) expect(PREVIEW_WIDTHS).toContain(width)
  })

  it('does not throw on a file it cannot read', () => {
    // Nothing depends on warming having worked: the protocol handler still
    // builds whatever is missing on demand.
    expect(() => warmPreviews(join(tmpdir(), 'checkpoint-no-such-image.png'))).not.toThrow()
  })
})
