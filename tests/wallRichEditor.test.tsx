// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRef, type MutableRefObject } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { $getRoot, $isTextNode, type LexicalEditor, type TextNode } from 'lexical'
import WallRichEditor from '../src/renderer/src/components/wall/WallRichEditor'
import { standInForRangeLayout } from './helpers/rangeLayout'

afterEach(cleanup)

beforeAll(standInForRangeLayout)

type Props = Parameters<typeof WallRichEditor>[0]

async function open(value: string, props: Partial<Props> = {}) {
  const onChange = vi.fn()
  const onFinish = vi.fn()
  const editorRef = createRef<LexicalEditor | null>() as MutableRefObject<LexicalEditor | null>
  await act(async () => {
    render(<WallRichEditor value={value} onChange={onChange} onFinish={onFinish} boxSize={20} boxAlign="left" editorRef={editorRef} {...props} />)
  })
  const editor = editorRef.current as LexicalEditor
  const box = screen.getByRole('textbox')
  return { onChange, onFinish, editor, box, last: () => onChange.mock.calls.at(-1)?.[0] as string | undefined }
}

/** selects characters across the whole text, as the person would by dragging */
async function select(editor: LexicalEditor, from: number, to: number) {
  await act(async () => {
    editor.update(() => {
      // a position counts characters through the whole text, a line break between lines
      const lines = $getRoot().getChildren().map(line => ('getAllTextNodes' in line ? (line as unknown as { getAllTextNodes(): TextNode[] }).getAllTextNodes() : []))
      const locate = (at: number): [TextNode, number] => {
        let seen = 0
        for (const nodes of lines) {
          for (const node of nodes) {
            const size = node.getTextContentSize()
            if (at <= seen + size) return [node, at - seen]
            seen += size
          }
          seen += 1
        }
        const end = lines.flat().at(-1) as TextNode
        return [end, end.getTextContentSize()]
      }
      const [a, aOffset] = locate(from)
      const [b, bOffset] = locate(to)
      const selection = a.select(aOffset, aOffset)
      selection.focus.set(b.getKey(), bOffset, 'text')
    })
  })
}

const press = async (box: HTMLElement, key: string, extra: Partial<KeyboardEventInit> = {}) => {
  await act(async () => { fireEvent.keyDown(box, { key, ...extra }) })
}

describe('writing in a wall box', () => {
  it('finishes on Escape and on Ctrl+Enter', async () => {
    const { box, onFinish } = await open('hello')
    await press(box, 'Escape')
    await press(box, 'Enter', { ctrlKey: true })
    expect(onFinish).toHaveBeenCalledTimes(2)
  })

  it('leaves an old box exactly as it was when nothing is changed', async () => {
    const { onChange } = await open('*old style* and - not a list')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hands back the old text as it was written when a change is undone', async () => {
    const { box, editor, last } = await open('*old style* stays')
    await select(editor, 10, 15)
    await press(box, 'b', { ctrlKey: true })
    expect(last()).toBe('_old style_ **stays**')
    await press(box, 'z', { ctrlKey: true })
    expect(last()).toBe('*old style* stays')
  })

  it('keeps bold and links pasted from a web page, but not the page\'s colours or sizes', async () => {
    const { box, last } = await open('')
    const html = '<p><span style="color: rgb(255, 0, 0); font-size: 30px"><b>Big news</b></span> and <a href="https://example.com/more">more</a></p>'
    await act(async () => {
      fireEvent.paste(box, { clipboardData: { types: ['text/html', 'text/plain'], getData: (type: string) => (type === 'text/html' ? html : 'Big news and more') } })
    })
    expect(last()).toBe('**Big news** and [more](https://example.com/more)')
  })

  it('continues a list on Enter, and leaves it from an empty item', async () => {
    const { box, editor, last } = await open('- milk')
    await select(editor, 6, 6)
    await press(box, 'Enter')
    expect(last()).toBe('- milk\n- ')
    await press(box, 'Enter')
    expect(last()).toBe('- milk\n')
  })

  it('bolds, italicises, underlines, strikes and marks code on the selection', async () => {
    const { box, editor, last } = await open('hello world')
    await select(editor, 0, 5)
    await press(box, 'b', { ctrlKey: true })
    expect(last()).toBe('**hello** world')
    await press(box, 'i', { ctrlKey: true })
    expect(last()).toBe('**_hello_** world')
    await select(editor, 6, 11)
    await press(box, 'x', { ctrlKey: true, shiftKey: true })
    expect(last()).toBe('**_hello_** ~~world~~')
    await press(box, 'e', { ctrlKey: true })
    expect(last()).toBe('**_hello_** ~~`world`~~')
    await press(box, 'u', { ctrlKey: true })
    expect(last()).toBe('**_hello_** ~~++`world`++~~')
  })

  it('goes to the next item with Tab outside a list, and indents inside one', async () => {
    const onNext = vi.fn()
    const plain = await open('plain', { onNext })
    await press(plain.box, 'Tab')
    await press(plain.box, 'Tab', { shiftKey: true })
    expect(onNext.mock.calls).toStrictEqual([['right'], ['bottom']])
    cleanup()

    const list = await open('- a', { onNext })
    await select(list.editor, 3, 3)
    await press(list.box, 'Tab')
    expect(list.last()).toBe('  - a')
    await press(list.box, 'Tab', { shiftKey: true })
    expect(list.last()).toBe('- a')
  })

  it('adds a topic under on Tab and beside on Enter in a mind map', async () => {
    const onChild = vi.fn()
    const onSibling = vi.fn()
    const { box } = await open('Root', { onChild, onSibling })
    await press(box, 'Tab')
    await press(box, 'Enter')
    expect(onChild).toHaveBeenCalledTimes(1)
    expect(onSibling).toHaveBeenCalledTimes(1)
  })
})

describe('the text bar', () => {
  it('colours, sizes and sets the font of just the selected words', async () => {
    const { editor, last } = await open('one two three')
    await select(editor, 4, 7)
    await act(async () => { fireEvent.click(screen.getByLabelText('Text colour')) })
    await act(async () => { fireEvent.click(screen.getAllByRole('button').find(b => /f28b82/i.test(b.getAttribute('aria-label') ?? '') || /f28b82/i.test(b.title)) as HTMLElement) })
    expect(last()).toBe('one [two]{color=#f28b82} three')

    const size = screen.getByLabelText('Size') as HTMLInputElement
    await act(async () => { fireEvent.focus(size) })
    await act(async () => { fireEvent.change(size, { target: { value: '40' } }) })
    await act(async () => { fireEvent.keyDown(size, { key: 'Enter' }) })
    expect(last()).toBe('one [two]{color=#f28b82 size=2} three')

    await act(async () => { fireEvent.click(screen.getByLabelText('Font: Sans')) })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Serif' })) })
    expect(last()).toBe('one [two]{color=#f28b82 size=2 font=serif} three')
  })

  it('shows the size of the words selected, steps it a point at a time, and blanks it when they differ', async () => {
    const { editor, last } = await open('[big]{size=2} small')
    await select(editor, 0, 3)
    expect((screen.getByLabelText('Size') as HTMLInputElement).value).toBe('40')
    await act(async () => { fireEvent.click(screen.getByLabelText('Bigger')) })
    expect(last()).toBe('[big]{size=2.05} small')
    await select(editor, 0, 9)
    expect((screen.getByLabelText('Size') as HTMLInputElement).value).toBe('')
  })

  it('aligns the lines the selection touches, and a line set back to the box\'s alignment follows the box again', async () => {
    const { editor, last } = await open('one\ntwo')
    await select(editor, 0, 1)
    await act(async () => { fireEvent.click(screen.getByLabelText('Centre')) })
    expect(last()).toBe('{align=center}one\ntwo')
    await act(async () => { fireEvent.click(screen.getByLabelText('Align left')) })
    expect(last()).toBe('one\ntwo')
  })

  it('links the selected words, and only offers a link once something is selected', async () => {
    const { editor, last } = await open('see the docs')
    await select(editor, 4, 4)
    expect((screen.getByLabelText('Link') as HTMLButtonElement).disabled).toBe(true)
    await select(editor, 4, 12)
    await act(async () => { fireEvent.click(screen.getByLabelText('Link')) })
    await act(async () => { fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'https://example.com/docs' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply' })) })
    expect(last()).toBe('see [the docs](https://example.com/docs)')
  })
})

describe('what the editor holds', () => {
  it('loads styled, linked and aligned text as words wearing it', async () => {
    const { editor } = await open('{align=right}[**big**]{color=#e44332 size=2} [docs](https://x.example)')
    const nodes = editor.getEditorState().read(() => $getRoot().getAllTextNodes().filter($isTextNode).map(n => [n.getTextContent(), n.hasFormat('bold'), n.getStyle()]))
    expect(nodes[0]).toStrictEqual(['big', true, 'color: #e44332; font-size: 2em'])
    expect(document.querySelector('a, .wall-text-link')?.textContent).toBe('docs')
  })
})
