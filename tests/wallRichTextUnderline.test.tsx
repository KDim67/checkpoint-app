// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import WallRichText from '../src/renderer/src/components/wall/WallRichText'

afterEach(cleanup)

describe('WallRichText underline', () => {
  it('draws ++words++ underlined', () => {
    const { container } = render(<WallRichText text="plain ++marked++" />)
    expect(container.querySelector('u')?.textContent).toBe('marked')
  })
})
