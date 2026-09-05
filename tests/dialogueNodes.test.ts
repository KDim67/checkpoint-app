import { describe, it, expect } from 'vitest'
import { normalizeDialogueNodes } from '../src/renderer/src/components/gamedev/types'

// The dialogue editor is loaded straight from a model's reply, so what it is
// handed decides whether the editor opens or throws.

let counter = 0
const makeId = (): string => `generated_${counter++}`

describe('a dialogue tree the model returned', () => {
  it('keeps a well-formed tree', () => {
    const nodes = normalizeDialogueNodes([
      { id: 'start', speaker: 'Hero', text: 'Hello', choices: [{ text: 'Hi', nextId: 'a' }] }
    ], makeId)
    expect(nodes).toEqual([
      { id: 'start', speaker: 'Hero', text: 'Hello', choices: [{ text: 'Hi', nextId: 'a' }] }
    ])
  })

  it('accepts target as well as nextId', () => {
    // Both names have been asked for by prompts in this app, and replies still
    // come back either way.
    const [node] = normalizeDialogueNodes([
      { id: 'n', speaker: 's', text: 't', choices: [{ text: 'go', target: 'elsewhere' }] }
    ], makeId)
    expect(node.choices[0].nextId).toBe('elsewhere')
  })

  it('invents an id when the model forgot one', () => {
    // The editor keys off the id, so two blanks would collide into one node.
    const nodes = normalizeDialogueNodes([
      { speaker: 'a', text: 'one' },
      { speaker: 'b', text: 'two' }
    ], makeId)
    expect(nodes[0].id).not.toBe(nodes[1].id)
    expect(nodes[0].id).toBeTruthy()
  })

  it('falls back to NPC rather than an empty speaker', () => {
    expect(normalizeDialogueNodes([{ id: 'n', text: 't' }], makeId)[0].speaker).toBe('NPC')
  })

  it('drops entries that are not nodes at all', () => {
    const nodes = normalizeDialogueNodes(['a string', null, 42, { id: 'real', text: 'x' }], makeId)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('real')
  })

  it('survives choices that are not a list', () => {
    const [node] = normalizeDialogueNodes([{ id: 'n', text: 't', choices: 'nope' }], makeId)
    expect(node.choices).toEqual([])
  })

  it('drops a choice that is not an object', () => {
    const [node] = normalizeDialogueNodes([
      { id: 'n', text: 't', choices: ['yes', null, { text: 'ok', nextId: 'a' }] }
    ], makeId)
    expect(node.choices).toEqual([{ text: 'ok', nextId: 'a' }])
  })

  it('is empty when the reply is not a list', () => {
    expect(normalizeDialogueNodes(null, makeId)).toEqual([])
    expect(normalizeDialogueNodes({ nodes: [] }, makeId)).toEqual([])
    expect(normalizeDialogueNodes('I cannot help with that', makeId)).toEqual([])
  })
})
