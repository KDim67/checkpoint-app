// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FeatureToggleCenter from '../src/renderer/src/components/settings/FeatureToggleCenter'

const mockSettings = new Map<string, unknown>()

vi.mock('../src/renderer/src/data/settings', () => ({
  getSetting: vi.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, val: unknown) => {
    mockSettings.set(key, val)
  }),
  deleteSetting: vi.fn(async (key: string) => {
    mockSettings.delete(key)
  })
}))

vi.mock('../src/renderer/src/data/webhook', () => ({
  toggle: vi.fn(),
  getToken: vi.fn(async () => '')
}))

vi.mock('../src/renderer/src/data/sync', () => ({
  startHost: vi.fn(),
  stopHost: vi.fn()
}))

describe('FeatureToggleCenter 1-Click Profile Switcher', () => {
  beforeEach(() => {
    mockSettings.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders both Focused & Clean and Full Suite preset buttons', async () => {
    render(<FeatureToggleCenter />)

    await waitFor(() => {
      expect(screen.getByTestId('profile-focused-btn')).toBeTruthy()
      expect(screen.getByTestId('profile-full-btn')).toBeTruthy()
    })

    expect(screen.getByText('Focused & Clean')).toBeTruthy()
    expect(screen.getByText('Full Suite')).toBeTruthy()
  })

  it('switches to Full Suite preset on click and updates settings', async () => {
    render(<FeatureToggleCenter />)

    await waitFor(() => {
      expect(screen.getByTestId('profile-full-btn')).toBeTruthy()
    })

    const fullBtn = screen.getByTestId('profile-full-btn')
    fireEvent.click(fullBtn)

    await waitFor(() => {
      expect(mockSettings.get('layout_profile')).toBe('full')
      expect(mockSettings.get('feature_view_log')).toBe('true')
      expect(mockSettings.get('feature_view_cheatsheets')).toBe('true')
      expect(mockSettings.get('feature_view_analytics')).toBe('true')
    })
  })

  it('switches back to Focused & Clean preset on click', async () => {
    mockSettings.set('layout_profile', 'full')
    mockSettings.set('feature_view_log', 'true')

    render(<FeatureToggleCenter />)

    await waitFor(() => {
      expect(screen.getByTestId('profile-focused-btn')).toBeTruthy()
    })

    const focusedBtn = screen.getByTestId('profile-focused-btn')
    fireEvent.click(focusedBtn)

    await waitFor(() => {
      expect(mockSettings.get('layout_profile')).toBe('focused')
      expect(mockSettings.get('feature_view_log')).toBe('false')
      expect(mockSettings.get('feature_view_cheatsheets')).toBe('false')
      expect(mockSettings.get('feature_view_analytics')).toBe('false')
    })
  })
})

describe('what each switch on the features page says', () => {
  beforeEach(() => {
    mockSettings.clear()
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('names each view the way the sidebar does, and marks the chosen starting set', async () => {
    mockSettings.set('layout_profile', 'full')
    render(<FeatureToggleCenter />)
    expect(await screen.findByRole('switch', { name: 'Kanban' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Game Dev' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Full Suite/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /Focused & Clean/ }).getAttribute('aria-checked')).toBe('false')
  })

  it('says what being off means only while it is off, and what to know before turning on whichever way it is', async () => {
    mockSettings.set('feature_view_renewals', 'false')
    render(<FeatureToggleCenter />)
    await screen.findByRole('switch', { name: 'Renewals' })
    expect(screen.getByText(/Warnings for what is already tracked keep coming/)).toBeTruthy()
    expect(screen.getByText(/Copies are kept as plain text/)).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: 'Renewals' }))
    await waitFor(() => expect(screen.queryByText(/Warnings for what is already tracked keep coming/)).toBeNull())
    expect(screen.getByText(/Copies are kept as plain text/)).toBeTruthy()
  })

  it('shows no emoji in place of an icon', async () => {
    const { container } = render(<FeatureToggleCenter />)
    await screen.findByRole('switch', { name: 'Kanban' })
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
