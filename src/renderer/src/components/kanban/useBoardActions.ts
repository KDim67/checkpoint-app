import { useEffect, useCallback } from 'react'
import type { Item } from '../../../../shared/types'
import { useFailureReport } from '../ui/Toast'
import { bulkUpdateItems, createItem, deleteItem, updateItem } from '../../data/items'
import { cardFromTemplate, isTemplateCard } from '../../../../shared/cardTemplates'
import type { BoardState } from './useBoardState'

export function useBoardActions(boardState: BoardState) {
  const {
    activeWorkspace, toast, confirm, cards, setCards, columns, setColumns, columnsRef,
    persistColumns, persistConfig, setShowAddColModal, setActiveCardId, setPendingDeleteColId,
    allTags, archivedColumns, setArchivedColumns, archivedColumnsRef, showArchiveBin,
    selectedArchived, setSelectedArchived, setShowTemplateSelector, loadCards
  } = boardState

  const report = useFailureReport()

  const handleCreateColumnSubmit = async (name: string, wipLimit: number | null, color?: string, colorMode?: 'header' | 'full', description?: string) => {
    const id = `col-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
    const updatedCols = [...columnsRef.current, { id, name, wipLimit, color, colorMode, description }]
    try {
      // the modal stays open with what was typed when the save fails
      if (!(await persistColumns(updatedCols))) return
      setShowAddColModal(false)
      toast(`Column "${name}" created`)
    } catch (err) {
      report('create the column', err)
    }
  }

  const handleRenameColumn = useCallback(async (colId: string, newName: string, newWipLimit: number | null, color?: string, colorMode?: 'header' | 'full') => {
    const updatedCols = columnsRef.current.map(c => c.id === colId ? { ...c, name: newName, wipLimit: newWipLimit, color, colorMode } : c)
    try {
      if (!(await persistColumns(updatedCols))) return
      toast(`Column "${newName}" updated`)
    } catch (err) {
      report('update the column', err)
    }
  }, [columnsRef, persistColumns, toast, report])

  const performDeleteColumn = useCallback(async (colId: string) => {
    // latest columns via ref, so two quick deletes don't write back a removed one
    const current = columnsRef.current
    const colName = current.find(c => c.id === colId)?.name || 'Column'
    const updatedCols = current.filter(c => c.id !== colId)
    try {
      const cardsToMove = cards.filter(c => c.status === colId)
      if (cardsToMove.length > 0) {
        const fallbackColId = updatedCols[0]?.id ?? 'open'
        await bulkUpdateItems({
          ids: cardsToMove.map(c => c.id),
          patch: { status: fallbackColId }
        })
      }
      const saved = await persistColumns(updatedCols)
      setPendingDeleteColId(null)
      loadCards()
      if (saved) toast(`Column "${colName}" deleted. Remaining cards moved.`)
    } catch (err) {
      report('delete the column', err)
      loadCards()
    }
  }, [columnsRef, cards, persistColumns, setPendingDeleteColId, loadCards, toast, report])

  const handleDeleteColumn = useCallback(async (colId: string) => {
    const cardsToMove = cards.filter(c => c.status === colId)
    if (cardsToMove.length > 0) {
      setPendingDeleteColId(colId)
    } else {
      await performDeleteColumn(colId)
    }
  }, [cards, performDeleteColumn, setPendingDeleteColId])

  const handleClearColumnCards = useCallback(async (columnId: string) => {
    const colCards = cards.filter(c => c.status === columnId)
    if (colCards.length === 0) return

    try {
      await bulkUpdateItems({
        ids: colCards.map(c => c.id),
        patch: { status: 'archived' }
      })
      loadCards()
      toast(`Archived all cards in column`)
    } catch (err) {
      report('archive the cards', err)
    }
  }, [cards, loadCards, toast, report])

  const handleArchiveColumn = useCallback(async (colId: string) => {
    const current = columnsRef.current
    const colToArchive = current.find(c => c.id === colId)
    if (!colToArchive) return

    const before = { columns: current, archived: archivedColumnsRef.current }
    try {
      // one patch: separate writes could leave the column in neither list
      const updatedArchived = [...archivedColumnsRef.current, colToArchive]
      const updatedCols = current.filter(c => c.id !== colId)
      columnsRef.current = updatedCols
      archivedColumnsRef.current = updatedArchived
      setColumns(updatedCols)
      setArchivedColumns(updatedArchived)
      if (!(await persistConfig({ columns: updatedCols, archivedColumns: updatedArchived }))) {
        columnsRef.current = before.columns
        archivedColumnsRef.current = before.archived
        setColumns(before.columns)
        setArchivedColumns(before.archived)
        return
      }
      loadCards()
      toast(`Column "${colToArchive.name}" archived`)
    } catch (err) {
      report('archive the column', err)
    }
  }, [columnsRef, archivedColumnsRef, setColumns, setArchivedColumns, persistConfig, loadCards, toast, report])

  const handleUpdateCardDetails = useCallback(async (id: string, patch: Partial<Item>, tagIds?: string[]) => {
    try {
      setCards(prev => prev.map(c => {
        if (c.id === id) {
          const updated = { ...c, ...patch }
          if (tagIds !== undefined) {
            updated.tags = allTags.filter(t => tagIds.includes(t.id))
          }
          return updated
        }
        return c
      }))
      await updateItem(id, patch, tagIds)
      loadCards()
    } catch (err) {
      report('save the card', err)
      loadCards()
      throw err
    }
  }, [setCards, loadCards, allTags, report])

  const handleCardDelete = useCallback(async (id: string) => {
    try {
      const originalIndex = cards.findIndex(c => c.id === id)
      if (originalIndex === -1) return
      const targetCard = cards[originalIndex]
      await updateItem(id, { status: 'archived' })
      setCards(prev => prev.filter(c => c.id !== id))
      
      toast('Card archived.', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await updateItem(id, { status: targetCard.status })
              setCards(prev => {
                const updated = [...prev]
                updated.splice(originalIndex, 0, targetCard)
                return updated
              })
              toast('Card restored')
            } catch (err) {
              report('restore the card', err)
            }
          }
        }
      })
    } catch (err) {
      report('archive the card', err)
    }
  }, [cards, setCards, toast, report])

  const handleCardConvertToTask = useCallback(async (id: string) => {
    try {
      const targetCard = cards.find(c => c.id === id)
      await updateItem(id, { type: 'task', status: 'open' })
      setCards(prev => prev.filter(c => c.id !== id))
      toast(`Card "${targetCard?.title}" converted to Backlog Task`)
    } catch (err) {
      report('move the card to the backlog', err)
    }
  }, [cards, setCards, toast, report])

  const handleAddCardToColumn = useCallback(async (columnId: string) => {
    try {
      const colCards = cards.filter(c => c.status === columnId)
      const defaultPos = colCards.length > 0
        ? Math.max(...colCards.map(c => c.position)) + 1000.0
        : 1000.0
      const created = await createItem({
        type: 'card',
        context: activeWorkspace,
        title: 'New card',
        body: '',
        status: columnId,
        priority: 0,
        position: defaultPos,
        due_at: null,
        metadata: '{}'
      })
      setCards(prev => [...prev, created])
      setActiveCardId(created.id)
    } catch (err) {
      console.error('Failed to create card:', err)
    }
  }, [cards, activeWorkspace, setCards, setActiveCardId])

  const handleCreateCardFromTemplate = async (templateCard: Item) => {
    setShowTemplateSelector(false)
    try {
      const made = cardFromTemplate(templateCard, columns, cards, activeWorkspace, Date.now())
      if (!made) {
        toast('Add a column first.', { type: 'info' })
        return
      }

      const created = await createItem(made.payload, made.tagIds)

      setCards(prev => [...prev, created])
      setActiveCardId(created.id)
      toast(`Created card from template "${templateCard.title}"`)
    } catch (err) {
      report('create the card from the template', err)
    }
  }

  const handleRestoreColumn = async (colId: string) => {
    const colToRestore = archivedColumns.find(c => c.id === colId)
    if (!colToRestore) return

    const before = { columns, archived: archivedColumns }
    try {
      // one patch, a half-failed restore left it in both lists
      const updatedCols = [...columns, colToRestore]
      const updatedArchived = archivedColumns.filter(c => c.id !== colId)
      columnsRef.current = updatedCols
      setColumns(updatedCols)
      setArchivedColumns(updatedArchived)
      if (!(await persistConfig({ columns: updatedCols, archivedColumns: updatedArchived }))) {
        columnsRef.current = before.columns
        setColumns(before.columns)
        setArchivedColumns(before.archived)
        return
      }
      toast(`Column "${colToRestore.name}" restored`)
    } catch (err) {
      report('restore the column', err)
    }
  }

  const handleDeleteColumnPermanently = async (colId: string) => {
    const colName = archivedColumns.find(c => c.id === colId)?.name || 'Column'
    const confirmed = await confirm({
      title: 'Delete list permanently',
      message: `Permanently delete list "${colName}"? Any cards that belong to this list will remain archived.`,
      confirmText: 'Delete List',
      isDestructive: true
    })
    if (confirmed) {
      const before = archivedColumns
      try {
        const updatedArchived = archivedColumns.filter(c => c.id !== colId)
        setArchivedColumns(updatedArchived)
        if (!(await persistConfig({ archivedColumns: updatedArchived }))) {
          setArchivedColumns(before)
          return
        }
        toast(`List "${colName}" deleted permanently`)
      } catch (err) {
        report('delete the list', err)
      }
    }
  }

  const handleRestoreCard = async (cardId: string) => {
    const targetCard = cards.find(c => c.id === cardId)
    if (!targetCard) return

    const fallbackCol = columns[0]
    if (!fallbackCol) {
      toast('Add a column first to restore the card.', { type: 'info' })
      return
    }

    const destColId = columns.some(c => c.id === targetCard.status)
      ? targetCard.status
      : fallbackCol.id

    try {
      await updateItem(cardId, { status: destColId })
      loadCards()
      toast(`Card "${targetCard.title}" restored`)
    } catch (err) {
      report('restore the card', err)
    }
  }

  const handleBulkDeleteArchived = async (): Promise<void> => {
    const ids = Array.from(selectedArchived)
    if (ids.length === 0) return
    const confirmed = await confirm({
      title: 'Delete archived cards',
      message: `Permanently delete ${ids.length} archived card${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true
    })
    if (!confirmed) return
    try {
      await Promise.all(ids.map(id => deleteItem(id)))
      setCards(prev => prev.filter(c => !selectedArchived.has(c.id)))
      setSelectedArchived(new Set())
      toast(`${ids.length} card${ids.length > 1 ? 's' : ''} deleted permanently`)
    } catch (err) {
      report('delete every card', err)
      loadCards()
    }
  }

  const handleBulkRestoreArchived = async (): Promise<void> => {
    const ids = Array.from(selectedArchived)
    if (ids.length === 0) return
    const fallbackCol = columns[0]
    if (!fallbackCol) {
      toast('Add a column first to restore cards.', { type: 'info' })
      return
    }
    try {
      await Promise.all(ids.map(id => {
        const card = cards.find(c => c.id === id)
        const dest = card && columns.some(c => c.id === card.status) ? card.status : fallbackCol.id
        return updateItem(id, { status: dest })
      }))
      setSelectedArchived(new Set())
      loadCards()
      toast(`${ids.length} card${ids.length > 1 ? 's' : ''} restored`)
    } catch (err) {
      report('restore every card', err)
      loadCards()
    }
  }

  const handleDeleteArchivedCard = async (card: Item): Promise<void> => {
    const confirmed = await confirm({
      title: 'Delete card permanently',
      message: `Permanently delete card "${card.title}"? This cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true
    })
    if (confirmed) {
      try {
        await deleteItem(card.id)
        setCards(prev => prev.filter(c => c.id !== card.id))
        setSelectedArchived(prev => { const n = new Set(prev); n.delete(card.id); return n })
        toast('Card deleted permanently')
      } catch (err) {
        report('delete the card', err)
      }
    }
  }

  // clear the selection when the drawer closes
  useEffect(() => {
    if (!showArchiveBin) setSelectedArchived(new Set())
  }, [setSelectedArchived, showArchiveBin])

  const templateCards = cards.filter(isTemplateCard)

  return {
    handleCreateColumnSubmit,
    handleRenameColumn,
    performDeleteColumn,
    handleDeleteColumn,
    handleClearColumnCards,
    handleArchiveColumn,
    handleUpdateCardDetails,
    handleCardDelete,
    handleCardConvertToTask,
    handleAddCardToColumn,
    handleCreateCardFromTemplate,
    handleRestoreColumn,
    handleDeleteColumnPermanently,
    handleRestoreCard,
    handleBulkDeleteArchived,
    handleBulkRestoreArchived,
    handleDeleteArchivedCard,
    templateCards
  }
}

export type BoardActions = ReturnType<typeof useBoardActions>
