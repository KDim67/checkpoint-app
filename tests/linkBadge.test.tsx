// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ConnectionLink } from '../src/shared/connections'

const opened = vi.hoisted(() => [] as string[])
vi.mock('../src/renderer/src/data/app', () => ({ openExternal: vi.fn(async (url: string) => { opened.push(url) }) }))

import LinkBadge from '../src/renderer/src/components/kanban/LinkBadge'

const link = (over: Partial<ConnectionLink> = {}): ConnectionLink => ({
  service: 'github', id: 'octo/repo#12', url: 'https://github.com/octo/repo/issues/12', state: 'open', labels: ['bug', 'ui', 'p1'], ...over
})

afterEach(() => {
  cleanup()
  opened.length = 0
})

describe('a connected card\'s badge', () => {
  it('names the issue and its state, and shows the first two labels', () => {
    render(<LinkBadge link={link()} />)
    const badge = screen.getByRole('button', { name: 'octo/repo#12, open. Open on GitHub' })
    expect(badge.textContent).toBe('#12')
    expect(screen.getAllByText(/^(bug|ui|p1)$/).map(e => e.textContent)).toStrictEqual(['bug', 'ui'])
  })

  it('says what needs a look', () => {
    render(<LinkBadge link={link({ state: 'gone', problem: 'Waiting to close on GitHub: offline.' })} />)
    const badge = screen.getByRole('button', { name: /no longer on GitHub\. Waiting to close/ })
    expect(badge.getAttribute('data-problem')).toBe('true')
  })

  it('names a Todoist task by its project, since its id means nothing to a person', () => {
    render(<LinkBadge link={{ service: 'todoist', id: '6XGgmFVcrG5RRjVr', url: 'https://app.todoist.com/app/task/6XGgmFVcrG5RRjVr', state: 'closed', labels: ['errands'], place: 'Groceries' }} />)
    const badge = screen.getByRole('button', { name: 'Todoist task in Groceries, completed. Open in Todoist' })
    expect(badge.textContent).toBe('')
    render(<LinkBadge link={{ service: 'todoist', id: 't2', url: 'https://app.todoist.com/app/task/t2', state: 'gone', labels: [] }} />)
    expect(screen.getByRole('button', { name: 'Todoist task, no longer in Todoist. Open in Todoist' })).toBeTruthy()
  })

  it('shows a Linear issue by its key, with Linear\'s own word for its state', () => {
    render(<LinkBadge link={{ service: 'linear', id: 'uuid-1', url: 'https://linear.app/acme/issue/ENG-123/x', state: 'closed', labels: [], ref: 'ENG-123', stateName: 'Canceled' }} />)
    const badge = screen.getByRole('button', { name: 'ENG-123, Canceled. Open in Linear' })
    expect(badge.textContent).toBe('ENG-123')
  })

  it('opens the issue without opening the card', () => {
    const openCard = vi.fn()
    render(<div onClick={openCard}><LinkBadge link={link()} /></div>)
    fireEvent.click(screen.getByRole('button'))
    expect(opened).toStrictEqual(['https://github.com/octo/repo/issues/12'])
    expect(openCard).not.toHaveBeenCalled()
  })
})
