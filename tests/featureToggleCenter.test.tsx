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
  toggle: vi.fn()
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
