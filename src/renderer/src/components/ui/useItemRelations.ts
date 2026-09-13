import { useEffect, useState } from 'react'
import type { Item, Relation, RelationType } from '@shared/types'
import { searchItems } from '../../data/items'
import { createRelation, deleteRelation, getRelations } from '../../data/relations'

/** held by the item's view, the panel unmounts on reload */
export function useItemRelations(itemId: string, owner: Item | null, activeWorkspace: string) {
  const [relations, setRelations] = useState<Relation[]>([])
  const [relationSearchQuery, setRelationSearchQuery] = useState('')
  const [relationSearchResults, setRelationSearchResults] = useState<Item[]>([])
  const [selectedRelationType, setSelectedRelationType] = useState<RelationType>('relates_to')

  useEffect(() => {
    if (!relationSearchQuery.trim()) {
      setRelationSearchResults([])
      return
    }

    const delayDebounceFn = setTimeout(async () => {
      try {
        const res = await searchItems({
          query: relationSearchQuery,
          context: activeWorkspace
        })
        // can't link to itself
        setRelationSearchResults(res.items.filter(i => i.id !== itemId))
      } catch (err) {
        console.error('Failed to search items for relations:', err)
      }
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [relationSearchQuery, itemId, activeWorkspace])

  const add = async (targetId: string) => {
    if (!owner) return
    try {
      await createRelation(owner.id, targetId, selectedRelationType)
      const rels = await getRelations(owner.id)
      setRelations(rels)
      setRelationSearchQuery('')
      setRelationSearchResults([])
    } catch (err) {
      console.error('Failed to create relation:', err)
    }
  }

  const remove = async (relationId: string) => {
    try {
      await deleteRelation(relationId)
      setRelations(prev => prev.filter(r => r.id !== relationId))
    } catch (err) {
      console.error('Failed to delete relation:', err)
    }
  }

  return {
    itemId,
    relations,
    setRelations,
    query: relationSearchQuery,
    setQuery: setRelationSearchQuery,
    results: relationSearchResults,
    type: selectedRelationType,
    setType: setSelectedRelationType,
    add,
    remove
  }
}

export type ItemRelations = ReturnType<typeof useItemRelations>
