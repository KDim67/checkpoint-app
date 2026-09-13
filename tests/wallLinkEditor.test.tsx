// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallLinkEditor from '../src/renderer/src/components/wall/WallLinkEditor'

afterEach(cleanup)

type Props = Parameters<typeof WallLinkEditor>[0]

const renderEditor = (over: Partial<Props> = {}) => {
  const handlers = {
    onSave: vi.fn<Props['onSave']>(),
    onRemove: vi.fn<Props['onRemove']>(),
    onPick: vi.fn<Props['onPick']>(),
    onOpen: vi.fn<Props['onOpen']>(),
    onClose: vi.fn<Props['onClose']>()
  }
  render(<WallLinkEditor {...handlers} {...over} />)
  return handlers
}

const field = () => screen.getByLabelText('Link address') as HTMLInputElement

describe('WallLinkEditor', () => {
  it('saves a typed domain as a full address, then closes', () => {
    const { onSave, onClose } = renderEditor()

    fireEvent.change(field(), { target: { value: 'github.com/KDim67' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith('https://github.com/KDim67')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says what is wrong instead of saving a link it could not open', () => {
    const { onSave, onClose } = renderEditor()

    fireEvent.change(field(), { target: { value: 'javascript:alert(1)' } })
    fireEvent.submit(field().form as HTMLFormElement)

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/web address/)
  })

  it('starts from the current link and offers to open or remove it', () => {
    const { onOpen, onRemove, onClose } = renderEditor({ link: 'https://example.com/', label: 'example.com' })
    expect(field().value).toBe('https://example.com/')
    expect(screen.getByText('Links to example.com')).toBeTruthy()

    fireEvent.click(screen.getByText('Open'))
    expect(onOpen).toHaveBeenCalledWith('https://example.com/')

    fireEvent.click(screen.getByText('Remove link'))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers neither Open nor Remove before there is a link', () => {
    renderEditor()
    expect(screen.queryByText('Open')).toBeNull()
    expect(screen.queryByText('Remove link')).toBeNull()
  })

  it('hands picking an item back to the Wall', () => {
    const { onPick } = renderEditor()
    fireEvent.click(screen.getByText('Pick an item on this wall'))
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape without saving', () => {
    const { onSave, onClose } = renderEditor({ link: 'https://example.com/' })
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
