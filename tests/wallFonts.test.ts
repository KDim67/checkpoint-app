// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { loadWallFonts, WALL_FONTS_HREF } from '../src/renderer/src/components/wall/wallFonts'

afterEach(() => { document.head.replaceChildren() })

describe("the Wall's own fonts", () => {
  it('are asked for once, however often the Wall opens', () => {
    loadWallFonts()
    loadWallFonts()
    const links = document.head.querySelectorAll('link[rel="stylesheet"]')
    expect(links).toHaveLength(1)
    expect((links[0] as HTMLLinkElement).href).toBe(WALL_FONTS_HREF)
  })

  it('bring the two faces the Wall offers that no system has', () => {
    expect(WALL_FONTS_HREF).toContain('family=Caveat')
    expect(WALL_FONTS_HREF).toContain('family=Nunito')
    // the app ships these two itself
    expect(WALL_FONTS_HREF).not.toContain('Inter')
    expect(WALL_FONTS_HREF).not.toContain('JetBrains')
  })
})
