import { describe, it, expect } from 'vitest'
import { decodeEntities, decodeHtmlBytes, iconExtension, parseLinkPreview } from '../src/shared/linkPreview'

const PAGE = 'https://example.com/blog/post'

describe('parseLinkPreview', () => {
  it('prefers the page\'s own card title and decodes its entities', () => {
    const html = '<head><title>Fallback</title><meta property="og:title" content="Tom &amp; Jerry&#39;s"></head>'
    expect(parseLinkPreview(html, PAGE).title).toBe('Tom & Jerry\'s')
  })

  it('falls back to the title tag when the card title is blank, with whitespace collapsed', () => {
    const html = '<head><meta property="og:title" content="  "><title>\n  Release\n  notes </title></head>'
    expect(parseLinkPreview(html, PAGE).title).toBe('Release notes')
  })

  it('takes the description in order of how deliberate it is, capped for a card', () => {
    expect(parseLinkPreview('<meta name="description" content="plain"><meta name="twitter:description" content="tweet">', PAGE).description)
      .toBe('tweet')
    const long = 'word '.repeat(200)
    const capped = parseLinkPreview(`<meta property="og:description" content="${long}">`, PAGE).description ?? ''
    expect(capped.length).toBeLessThanOrEqual(400)
    expect(capped.endsWith('…')).toBe(true)
  })

  it('reads single-quoted and unquoted attributes', () => {
    const html = '<meta property=\'og:title\' content=\'Quoted\'><link rel=icon href=/fav.png>'
    const got = parseLinkPreview(html, PAGE)
    expect(got.title).toBe('Quoted')
    expect(got.iconUrl).toBe('https://example.com/fav.png')
  })

  it('ignores tags in the body, a page can quote markup', () => {
    const html = '<head><title>Real</title></head><body><meta property="og:title" content="Quoted in body"></body>'
    expect(parseLinkPreview(html, PAGE).title).toBe('Real')
  })

  it('resolves the icon against the page and skips the one-colour mask icon', () => {
    const html = '<link rel="mask-icon" href="/mask.svg"><link rel="shortcut icon" href="../img/fav.ico">'
    expect(parseLinkPreview(html, PAGE).iconUrl).toBe('https://example.com/img/fav.ico')
  })

  it('uses the touch icon, then the site favicon, when the page names no icon', () => {
    expect(parseLinkPreview('<link rel="apple-touch-icon-precomposed" href="/touch.png">', PAGE).iconUrl)
      .toBe('https://example.com/touch.png')
    expect(parseLinkPreview('<title>No icon</title>', PAGE).iconUrl).toBe('https://example.com/favicon.ico')
  })

  it('refuses an icon address main could be tricked into reading', () => {
    // a script or file address falls through to the site favicon
    expect(parseLinkPreview('<link rel="icon" href="javascript:alert(1)">', PAGE).iconUrl).toBe('https://example.com/favicon.ico')
    expect(parseLinkPreview('<link rel="icon" href="file:///C:/secret.png">', PAGE).iconUrl).toBe('https://example.com/favicon.ico')
  })

  it('keeps an inline data icon', () => {
    const html = '<link rel="icon" href="data:image/png;base64,iVBORw0KGgo=">'
    expect(parseLinkPreview(html, PAGE).iconUrl).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('returns nothing it could not find', () => {
    const got = parseLinkPreview('', PAGE)
    expect(got.title).toBeUndefined()
    expect(got.description).toBeUndefined()
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities and leaves unknown ones', () => {
    expect(decodeEntities('a &lt;b&gt; &#x1F600; &#8212; &bogus; &nbsp;')).toBe('a <b> \u{1F600} \u2014 &bogus; \u00a0')
  })
})

describe('decodeHtmlBytes', () => {
  // "café" in windows-1252
  const cafe = new Uint8Array([0x63, 0x61, 0x66, 0xe9])

  it('honours the charset the server declares', () => {
    expect(decodeHtmlBytes(cafe, 'text/html; charset=windows-1252')).toBe('café')
  })

  it('finds a meta charset when the server says nothing', () => {
    const head = new TextEncoder().encode('<meta charset="windows-1252">')
    const bytes = new Uint8Array([...head, ...cafe])
    expect(decodeHtmlBytes(bytes, 'text/html')).toBe('<meta charset="windows-1252">café')
  })

  it('reads utf-8 when the declared charset is not a real one', () => {
    const bytes = new TextEncoder().encode('café')
    expect(decodeHtmlBytes(bytes, 'text/html; charset=made-up')).toBe('café')
  })
})

describe('iconExtension', () => {
  const bytes = (...values: number[]) => new Uint8Array([...values, 0, 0, 0, 0, 0, 0, 0, 0])

  it('goes by the bytes, servers often mislabel icons', () => {
    expect(iconExtension(bytes(0x89, 0x50, 0x4e, 0x47), 'application/octet-stream')).toBe('png')
    expect(iconExtension(bytes(0x00, 0x00, 0x01, 0x00), 'text/plain')).toBe('ico')
    expect(iconExtension(bytes(0xff, 0xd8, 0xff), null)).toBe('jpg')
    expect(iconExtension(bytes(0x47, 0x49, 0x46, 0x38), null)).toBe('gif')
    expect(iconExtension(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), null)).toBe('webp')
  })

  it('takes svg by its type or its markup', () => {
    expect(iconExtension(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), null)).toBe('svg')
    expect(iconExtension(new TextEncoder().encode('<!-- made by hand --><svg></svg>'), 'image/svg+xml')).toBe('svg')
  })

  it('refuses what is not an image, like a login page served as the favicon', () => {
    expect(iconExtension(new TextEncoder().encode('<!doctype html><html>'), 'text/html')).toBeNull()
    expect(iconExtension(new Uint8Array(), 'image/png')).toBeNull()
  })
})
