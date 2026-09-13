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
