import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// things that cost nothing once and a great deal when repeated for every item in a long list

const source = (file: string): string => readFileSync(resolve('src/renderer/src/components', file), 'utf8')

describe('the page every window starts from', () => {
  it('loads no stylesheet from the network, which would hold the first paint until it answered', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const links = html.match(/<link\b[^>]*>/g) ?? []
    expect(links.filter(link => /https?:\/\//.test(link))).toEqual([])
  })
})

describe('a component drawn once per item', () => {
  it.each(['kanban/KanbanCard.tsx', 'backlog/BacklogRow.tsx'])('%s brings no stylesheet of its own', file => {
    // a <style> per card put 1,500 copies of one rule on a big board, each checked against every card on every style update
    expect(source(file)).not.toMatch(/<style[\s>]/)
  })
})
