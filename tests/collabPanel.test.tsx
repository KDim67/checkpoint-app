// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CollabPanel from '../src/renderer/src/components/kanban/CollabPanel'
import type { CollabSession } from '../src/renderer/src/components/kanban/useCollabSession'
import { useAppStore } from '../src/renderer/src/store/appStore'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'

vi.mock('../src/renderer/src/data/settings', () => ({ getSetting: vi.fn(async () => null), setSetting: vi.fn(async () => {}) }))

beforeEach(() => {
  useAppStore.setState({ activeWorkspace: 'default', activeView: 'kanban', settingsTab: 'general' })
})
afterEach(cleanup)

type Member = CollabSession['roster'][number]
type Held = 'popoverOpen' | 'setPopoverOpen' | 'joinCode' | 'setJoinCode'
type Session = Omit<CollabSession, Held>

const fakeSession = (overrides: Partial<Session> = {}): Session => ({
  active: false,
  isHost: false,
  code: '',
  mode: 'collaborative',
  roster: [],
  progress: '',
  workspace: 'default',
  elsewhere: false,
  isReadOnly: false,
  displayName: '',
  setDisplayName: vi.fn(),
  saveDisplayName: vi.fn(),
  osUserName: 'dimitris',
  host: vi.fn(),
  join: vi.fn(),
  disconnect: vi.fn(),
  removeGuest: vi.fn(),
  rotateCode: vi.fn(),
  setGuestMode: vi.fn(),
  ...overrides
})

/** popover and passcode are board state; the rest is the session's */
function Board({ session, open }: { session: Session; open: boolean }) {
  const [popoverOpen, setPopoverOpen] = useState(open)
  const [joinCode, setJoinCode] = useState('')
  return (
    <ToastProvider>
      <CollabPanel session={{ ...session, popoverOpen, setPopoverOpen, joinCode, setJoinCode }} />
      <button>Somewhere else</button>
    </ToastProvider>
  )
}

const renderPanel = (overrides: Partial<Session> = {}, open = true) => {
  const session = fakeSession(overrides)
  render(<Board session={session} open={open} />)
  return session
}

const alex = { id: 'peer-1', name: 'Alex' } as Member

describe('CollabPanel', () => {
  it('opens from the header button', () => {
    renderPanel({}, false)
    expect(screen.queryByText('Share This Board')).toBeNull()

    fireEvent.click(screen.getByTitle('Share this board with someone else'))

    expect(screen.getByText('Share This Board')).toBeTruthy()
  })

  it('says on the header button whether this end is hosting or joined', () => {
    renderPanel({ active: true, isHost: true }, false)
    expect(screen.getByText('Hosting Live')).toBeTruthy()
    cleanup()

    renderPanel({ active: true, isHost: false }, false)
    expect(screen.getByText('Joined Live')).toBeTruthy()
  })

  it('hosts in either mode', () => {
    const session = renderPanel()

    fireEvent.click(screen.getByText('Collaborative'))
    fireEvent.click(screen.getByText('Read-Only'))

    expect(session.host).toHaveBeenNthCalledWith(1, 'collaborative')
    expect(session.host).toHaveBeenNthCalledWith(2, 'readonly')
  })

  it('keeps only digits in the passcode and joins once it is long enough', () => {
    const session = renderPanel()
    const field = screen.getByPlaceholderText('Passcode (e.g. 123456)') as HTMLInputElement
    const join = screen.getByText('Join') as HTMLButtonElement
    expect(join.disabled).toBe(true)

    fireEvent.change(field, { target: { value: '12a3-45' } })

    expect(field.value).toBe('12345')
    expect(join.disabled).toBe(false)
    fireEvent.click(join)
    expect(session.join).toHaveBeenCalledWith('12345')
  })

  it('gives the host its controls over the room', () => {
    const session = renderPanel({ active: true, isHost: true, mode: 'readonly', code: '482913', roster: [alex] })

    expect(screen.getByText('Host (Read-Only)')).toBeTruthy()
    expect(screen.getByText('In this board (1)')).toBeTruthy()

    fireEvent.click(screen.getByTitle(/^Remove /))
    expect(session.removeGuest).toHaveBeenCalledWith(alex)

    fireEvent.click(screen.getByText('Let them edit'))
    expect(session.setGuestMode).toHaveBeenCalledWith('collaborative')

    fireEvent.click(screen.getByText('Change passcode'))
    expect(session.rotateCode).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Disconnect Share'))
    expect(session.disconnect).toHaveBeenCalledTimes(1)
  })

  it('copies the passcode and says it did', () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel({ active: true, isHost: true, code: '482913' })

    fireEvent.click(screen.getByTitle('Click to copy passcode'))

    expect(writeText).toHaveBeenCalledWith('482913')
    expect(screen.getByText('Passcode copied to clipboard')).toBeTruthy()
  })

  it('gives a guest no say over who stays', () => {
    renderPanel({ active: true, isHost: false, roster: [alex] })

    expect(screen.getByText('Client')).toBeTruthy()
    expect(screen.getByText('Also here (1)')).toBeTruthy()
    expect(screen.queryByTitle(/^Remove /)).toBeNull()
    expect(screen.queryByText('Change passcode')).toBeNull()
  })

  it('warns when the share is another board, and takes you back to it', () => {
    renderPanel({ active: true, isHost: true, elsewhere: true, workspace: 'design', roster: [alex] })

    expect(screen.getByText('Elsewhere')).toBeTruthy()
    expect(screen.queryByTitle(/^Remove /)).toBeNull()
    expect(screen.queryByText('Change passcode')).toBeNull()

    fireEvent.click(screen.getByText('Go back to #design'))

    expect(useAppStore.getState().activeWorkspace).toBe('design')
    expect(screen.queryByText('Share This Board')).toBeNull()
  })

  it('sends someone after their own machines to Device Sync', () => {
    renderPanel()

    fireEvent.click(screen.getByText('Device Sync'))

    expect(useAppStore.getState().activeView).toBe('settings')
    expect(useAppStore.getState().settingsTab).toBe('sync')
    expect(screen.queryByText('Share This Board')).toBeNull()
  })

  it('closes when the pointer goes down somewhere else', () => {
    renderPanel()

    fireEvent.mouseDown(screen.getByText('Somewhere else'))

    expect(screen.queryByText('Share This Board')).toBeNull()
  })
})
