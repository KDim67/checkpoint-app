// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallItemView from '../src/renderer/src/components/wall/WallItemView'
import { fontSizeOf, type WallItem } from '../src/shared/wallModel'
import { standInForRangeLayout } from './helpers/rangeLayout'

afterEach(cleanup)
beforeAll(standInForRangeLayout)

type Props = ComponentProps<typeof WallItemView>

const item = (over: Partial<WallItem> = {}): WallItem =>
  ({ id: 'i', kind: 'note', x: 0, y: 0, width: 300, height: 200, z: 0, ...over } as WallItem)

const view = (over: Partial<WallItem>, props: Partial<Props> = {}) =>
  render(
    <WallItemView
      item={item(over)}
      editing={false}
      onTextChange={() => {}}
      onFinishEditing={() => {}}
      {...props}
    />
  )

describe('a code block on the wall', () => {
  it('draws the source coloured piece by piece, with its language named', () => {
    const { container } = view({ kind: 'code', text: 'const x = 1', language: 'typescript' })

    expect(container.textContent).toContain('const x = 1')
    expect(container.textContent).toContain('JavaScript / TypeScript')
    expect(container.querySelector('.wall-code-keyword')?.textContent).toBe('const')
  })

  it('writes in a plain box where Tab indents instead of leaving', () => {
    const onTextChange = vi.fn()
    view({ kind: 'code', text: 'x' }, { editing: true, onTextChange })

    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    box.setSelectionRange(1, 1)
    fireEvent.keyDown(box, { key: 'Tab' })

    expect(onTextChange).toHaveBeenCalledWith('i', 'x  ')
  })
})

describe('tags on a sticky', () => {
  it('shows each tag, wearing the board\'s colour where it has one', () => {
    const { container } = view({ tags: ['Bug', 'UI'] }, { tagColors: new Map([['bug', '#f28b82']]) })

    const chips = [...container.querySelectorAll('.wall-tag-chip')]
    expect(chips.map(c => c.textContent)).toStrictEqual(['Bug', 'UI'])
    const dot = chips[0].querySelector('.wall-tag-dot') as HTMLElement
    expect(dot.style.background.toLowerCase()).toMatch(/#f28b82|242, *139, *130/)
  })

  it('leaves the row out when a sticky has no tags', () => {
    expect(view({}).container.querySelector('.wall-tag-row')).toBeNull()
  })
})

describe('opening a sticky to write in', () => {
  it('puts the caret after the last word, so a new line goes below the others', async () => {
    const onTextChange = vi.fn()
    await act(async () => { view({ text: 'first line\nsecond line' }, { editing: true, onTextChange }) })
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }) })
    expect(onTextChange).toHaveBeenLastCalledWith('i', 'first line\nsecond line\n')
  })
})

describe('a chosen text size', () => {
  it('sets the words at it, and writing in them starts there too', () => {
    const { container } = view({ text: 'Hello', fontSize: 28 })
    expect((container.querySelector('.wall-paper > div > div') as HTMLElement).style.fontSize).toBe('28px')
    cleanup()

    view({ text: 'Hello', fontSize: 28 }, { editing: true })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).style.fontSize).toBe('28px')
  })

  it('falls back to the size the kind reads at', () => {
    expect(fontSizeOf(item({ kind: 'note' }))).toBe(13)
    expect(fontSizeOf(item({ kind: 'shape' }))).toBe(14)
    expect(fontSizeOf(item({ kind: 'text' }))).toBe(20)
  })
})

describe('a cropped picture', () => {
  const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }

  it('shows the kept part through a window, laid out bigger behind it', () => {
    const { container } = view({ kind: 'image', ref: 'p.png', crop })

    const picture = container.querySelector('img') as HTMLImageElement
    expect(picture.style.width).toBe('200%')
    expect(picture.style.left).toBe('-50%')
    expect((picture.parentElement as HTMLElement).style.overflow).toBe('hidden')
  })

  it('runs the picture past its box, which the image reset would otherwise squeeze back into it', () => {
    // preflight caps every image at its box's width: a crop kept on the left looked resized, one on the right was empty
    const { container } = view({ kind: 'image', ref: 'p.png', crop: { x: 0.5, y: 0, w: 0.5, h: 1 } })
    const picture = container.querySelector('img') as HTMLImageElement
    expect(picture.style.width).toBe('200%')
    expect(picture.style.left).toBe('-100%')
    expect(picture.style.maxWidth).toBe('none')
    // drawn twice the box's width, so the copy loaded is sharp enough for that, not just for the box
    expect(picture.getAttribute('src')).toContain('?w=1200&')
  })

  it('fills its box as before when it has never been cropped', () => {
    const { container } = view({ kind: 'image', ref: 'p.png' })
    const picture = container.querySelector('img') as HTMLImageElement
    expect(picture.style.objectFit).toBe('cover')
    expect(picture.style.width).toBe('100%')
  })

  it('opens the crop window over the picture and hands back the part kept', () => {
    const onCrop = vi.fn()
    const { container } = view({ kind: 'image', ref: 'p.png', crop }, { cropping: true, zoom: 2, onCrop })

    expect((container.querySelector('.wall-crop') as HTMLElement).style.getPropertyValue('--crop-inv')).toBe('0.5')
    fireEvent.click(screen.getByLabelText('Whole picture'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onCrop).toHaveBeenCalledWith('i', { x: 0, y: 0, w: 1, h: 1 })
  })
})

describe('a mind map topic', () => {
  it('adds one under it on Tab and one beside it on Enter, while writing', () => {
    const onMapTopic = vi.fn()
    view({ kind: 'shape', map: 'm', text: 'Root' }, { editing: true, onMapTopic })

    const box = screen.getByRole('textbox')
    fireEvent.keyDown(box, { key: 'Tab' })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(onMapTopic.mock.calls).toStrictEqual([['i', 'child'], ['i', 'sibling']])
  })

  it('leaves Tab to the next item when it is not a topic', () => {
    const onGrow = vi.fn()
    const onMapTopic = vi.fn()
    view({ text: 'plain' }, { editing: true, onGrow, onMapTopic })

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' })

    expect(onGrow).toHaveBeenCalledWith('i', 'right')
    expect(onMapTopic).not.toHaveBeenCalled()
  })
})
