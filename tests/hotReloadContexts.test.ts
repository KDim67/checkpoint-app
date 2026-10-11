import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// a context made in a module a hot reload re-runs comes back as a new one, and every open screen then throws for want of its provider

describe('a context whose hook throws without its provider', () => {
  it.each(['ui/toastContext.ts', 'ui/confirmContext.ts'])('%s imports nothing at run time but React, so no edit elsewhere re-runs it', file => {
    const source = readFileSync(resolve('src/renderer/src/components', file), 'utf8')
    const imports = source.match(/^import .*$/gm) ?? []
    const atRunTime = imports.filter(line => !line.startsWith('import type '))
    expect(atRunTime).toEqual([`import { createContext } from 'react'`])
  })

  it.each([['ui/Toast.tsx', 'ToastContext'], ['ui/ConfirmDialog.tsx', 'ConfirmContext']])('%s takes its context from there rather than making its own', (file, name) => {
    const source = readFileSync(resolve('src/renderer/src/components', file), 'utf8')
    expect(source).not.toMatch(/createContext\(/)
    expect(source).toContain(`import { ${name} } from`)
  })
})
