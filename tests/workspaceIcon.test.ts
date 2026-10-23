import { describe, expect, it, vi } from 'vitest'

// a workspace's picture: the square it keeps, and what it refuses before decoding anything

const saved = vi.hoisted(() => ({ calls: 0 }))
vi.mock('../src/renderer/src/data/media', () => ({ saveFromBuffer: vi.fn(async () => { saved.calls++; return 'never.webp' }) }))

import { centredSquare, iconUrl, MAX_SOURCE_BYTES, storeWorkspaceIcon } from '../src/renderer/src/lib/workspaceIcon'

describe('the square a picture keeps', () => {
  it('takes the middle of a wide image and of a tall one, and all of a square one', () => {
    expect(centredSquare(1600, 900)).toEqual({ x: 350, y: 0, size: 900 })
    expect(centredSquare(900, 1600)).toEqual({ x: 0, y: 350, size: 900 })
    expect(centredSquare(512, 512)).toEqual({ x: 0, y: 0, size: 512 })
  })

  it('keeps an odd leftover on whole pixels', () => {
    expect(centredSquare(101, 50)).toEqual({ x: 25, y: 0, size: 50 })
  })
})

describe('what it refuses before decoding', () => {
  it('turns away an SVG, a file that can carry scripts and links', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.svg', { type: 'image/svg+xml' })
    await expect(storeWorkspaceIcon(svg)).rejects.toThrow('Choose a PNG, JPEG, WebP, GIF, AVIF or BMP image.')
  })

  it('turns away a file too big to be worth decoding for a tile', async () => {
    const huge = new File([new Uint8Array(8)], 'photo.png', { type: 'image/png' })
    Object.defineProperty(huge, 'size', { value: MAX_SOURCE_BYTES + 1 })
    await expect(storeWorkspaceIcon(huge)).rejects.toThrow('That image is over 25 MB. Choose a smaller one.')
    expect(saved.calls).toBe(0)
  })

  it('names the stored file safely in its address', () => {
    expect(iconUrl('3f2b.webp')).toBe('checkpoint-media://3f2b.webp')
    expect(iconUrl('a b.webp')).toBe('checkpoint-media://a%20b.webp')
  })
})
