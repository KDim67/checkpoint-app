// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import WallRichText from '../src/renderer/src/components/wall/WallRichText'

afterEach(cleanup)

describe('WallRichText', () => {
  it('draws formatting, list markers and addresses you can ctrl+click', () => {
    const { container } = render(<WallRichText text={'**Plan** for _today_\n- read https://example.com\n2. ship ~~it~~'} />)

    expect(container.querySelector('strong')?.textContent).toBe('Plan')
    expect(container.querySelector('em')?.textContent).toBe('today')
    expect(container.querySelector('s')?.textContent).toBe('it')
    expect(screen.getByText('•')).toBeTruthy()
    expect(screen.getByText('2.')).toBeTruthy()

    const address = container.querySelector('[data-wall-url]')
    expect(address?.textContent).toBe('https://example.com')
    expect(address?.getAttribute('data-wall-url')).toBe('https://example.com/')
  })

  it('keeps a blank line as space between lines', () => {
    const { container } = render(<WallRichText text={'one\n\ntwo'} />)
    expect(container.querySelectorAll('[data-wall-line]')).toHaveLength(3)
  })
})

describe('words styled on their own', () => {
  it('draws a word\'s colour, size and font, and a link Ctrl+click opens', () => {
    const { container } = render(<WallRichText text={'Plain [big red]{color=#e44332 size=1.5 font=serif} and [docs](https://example.com/docs)'} />)
    const styled = [...container.querySelectorAll('span')].find(s => s.textContent === 'big red' && s.style.color) as HTMLElement
    expect(styled.style.color).toMatch(/#e44332|228, 67, 50/)
    expect(styled.style.fontSize).toBe('1.5em')
    expect(styled.style.fontFamily).toContain('Georgia')
    expect(container.querySelector('[data-wall-url="https://example.com/docs"]')?.textContent).toBe('docs')
  })

  it('aligns a line on its own, leaving the others to the box', () => {
    const { container } = render(<WallRichText text={'{align=center}Title\nbody'} />)
    const [title, body] = [...container.querySelectorAll('[data-wall-line]')] as HTMLElement[]
    expect(title.style.textAlign).toBe('center')
    expect(body.style.textAlign).toBe('')
  })
})
