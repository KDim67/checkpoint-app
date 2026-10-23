// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FieldRow, SettingsInput, SettingsSelect, ToggleRow, ToggleSwitch } from '../src/renderer/src/components/settings/SettingsSection'

afterEach(cleanup)

describe('a setting with a label above it', () => {
  it('names its select by the label, and reads the hint out with it', () => {
    render(
      <FieldRow label="Startup view" hint="The screen Checkpoint opens on.">
        <SettingsSelect value="a" onChange={() => {}}>
          <option value="a">Last used</option>
        </SettingsSelect>
      </FieldRow>
    )
    const select = screen.getByRole('combobox', { name: 'Startup view' })
    expect(document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent).toBe('The screen Checkpoint opens on.')
  })

  it('does the same for a text field, and points at no hint when there is none', () => {
    render(
      <FieldRow label="Model">
        <SettingsInput value="" onChange={() => {}} />
      </FieldRow>
    )
    expect(screen.getByRole('textbox', { name: 'Model' }).getAttribute('aria-describedby')).toBeNull()
  })

  it('names a group of choices by the label when there is no single control to name', () => {
    render(
      <FieldRow label="Font size" hint="Every piece of text grows or shrinks with it." group>
        <button type="button" aria-pressed>Small</button>
        <button type="button" aria-pressed={false}>Large</button>
      </FieldRow>
    )
    const group = screen.getByRole('group', { name: 'Font size' })
    expect(group.getAttribute('aria-describedby')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Small' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('a setting that is on or off', () => {
  it('flips when its name is clicked, as system settings do', () => {
    const onChange = vi.fn()
    render(<ToggleRow label="Compact mode" description="Tighter cards and rows." checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByText('Compact mode'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('is a switch named by its label and described by the line under it', () => {
    render(<ToggleRow label="Compact mode" description="Tighter cards and rows." checked onChange={() => {}} />)
    const toggle = screen.getByRole('switch', { name: 'Compact mode' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Tighter cards and rows.')
  })

  it('never flips while switched off', () => {
    const onChange = vi.fn()
    render(<ToggleRow label="Start hidden" checked={false} onChange={onChange} disabled />)
    fireEvent.click(screen.getByText('Start hidden'))
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('never submits a form it sits in', () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault())
    render(<form onSubmit={e => onSubmit(e.nativeEvent)}><ToggleSwitch checked={false} onChange={() => {}} label="Webhooks" /></form>)
    fireEvent.click(screen.getByRole('switch', { name: 'Webhooks' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
