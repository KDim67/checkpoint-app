import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      // src/main modules are written for the Electron main process, so importing
      // any of them drags in `electron` and the `better-sqlite3` native binding.
      // The binding is compiled against Electron's ABI and cannot be dlopen'd by
      // plain Node, so both are swapped for test doubles that keep the same
      // surface. See tests/stubs/betterSqlite3.ts for what that costs us.
      electron: resolve('tests/stubs/electron.ts'),
      'better-sqlite3': resolve('tests/stubs/betterSqlite3.ts')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
