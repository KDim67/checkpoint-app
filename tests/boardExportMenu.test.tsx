// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import BoardExportMenu from '../src/renderer/src/components/kanban/BoardExportMenu'

afterEach(cleanup)

describe('BoardExportMenu', () => {
  it('opens menu and triggers handleExportBoard on Export click', () => {
    const handleExportBoard = vi.fn()
    const handleImportBoard = vi.fn()

    const mockKanbanBoard = {
      handleExportBoard,
      handleImportBoard
    } as any

    render(<BoardExportMenu kanbanBoard={mockKanbanBoard} />)

    const toggleBtn = screen.getByTitle('Export or import Kanban board')
    expect(toggleBtn).toBeTruthy()

    fireEvent.click(toggleBtn)

    const exportBtn = screen.getByText('Export Board as JSON')
    expect(exportBtn).toBeTruthy()

    fireEvent.click(exportBtn)
    expect(handleExportBoard).toHaveBeenCalledTimes(1)
  })

  it('triggers handleImportBoard when a JSON file is selected in the file input', async () => {
    const handleExportBoard = vi.fn()
    const handleImportBoard = vi.fn()

    const mockKanbanBoard = {
      handleExportBoard,
      handleImportBoard
    } as any

    const { container } = render(<BoardExportMenu kanbanBoard={mockKanbanBoard} />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()

    const fileContent = JSON.stringify({
      checkpointType: 'kanban',
      version: 1,
      board: {
        cards: [{ title: 'Imported Card' }]
      }
    })

    const file = new File([fileContent], 'my-board.json', { type: 'application/json' })
    // Mock file.text() for jsdom
    file.text = vi.fn().mockResolvedValue(fileContent)

    fireEvent.change(input, { target: { files: [file] } })

    // Allow promise tick
    await vi.waitFor(() => {
      expect(handleImportBoard).toHaveBeenCalledWith(fileContent)
    })
  })
})
