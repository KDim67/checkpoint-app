import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  // automatic JSX runtime, components don't import React
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      // main modules pull in electron and the ABI-bound sqlite binding, so both are stubbed
      electron: resolve('tests/stubs/electron.ts'),
      'better-sqlite3': resolve('tests/stubs/betterSqlite3.ts')
    }
  },
  test: {
    // components opt into jsdom with a `@vitest-environment jsdom` docblock; the rest run in fast plain Node
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node'
  }
})
