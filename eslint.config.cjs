// @ts-check
const eslintPluginTypeScript = require('@typescript-eslint/eslint-plugin')
const parserTypeScript = require('@typescript-eslint/parser')
const eslintPluginReactHooks = require('eslint-plugin-react-hooks')

module.exports = [
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      // Nested checkouts and tool output land in dot-directories at the root.
      // The patterns above are anchored to the repo root and do not reach them.
      '.*/**',
      '*.config.*',
      // `tsc --build` on these composite projects emits .js/.jsx/.d.ts beside
      // the sources. Ignored so a stray build can never turn into lint noise.
      'src/**/*.js',
      'src/**/*.jsx'
    ]
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: parserTypeScript,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./tsconfig.node.json', './tsconfig.web.json']
      }
    },
    plugins: {
      '@typescript-eslint': eslintPluginTypeScript,
      'react-hooks': eslintPluginReactHooks
    },
    rules: {
      ...eslintPluginTypeScript.configs.recommended.rules,
      // The codebase already carried 7 `eslint-disable react-hooks/exhaustive-deps`
      // comments before this plugin was ever installed, so hook linting had never
      // actually run. rules-of-hooks catches real crashes and is an error;
      // exhaustive-deps is advisory and stays a warning.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // An error again. It was a warning while the codebase carried ~226 of
      // them, because 'error' meant `npm run lint` could never pass and so
      // nobody ran it. They are gone now, bar one documented disable in the
      // collaboration transport, so the gate holds the line rather than
      // counting the damage.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn'
    }
  },
  {
    // The renderer reaches the main process through src/renderer/src/data and
    // nowhere else. A screen that imports a data module can be tested against a
    // stand-in for it; a screen that reads the global cannot.
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/data/**'],
    rules: {
      'no-restricted-properties': ['error', {
        object: 'window',
        property: 'electronAPI',
        message: 'Reach the bridge through a module in src/renderer/src/data.'
      }]
    }
  },
  {
    // Tests live outside src/, so the block above does not reach them and they
    // would otherwise hit the default parser and fail on the first annotation.
    // no-explicit-any stays an error here: test code is new, so there is no
    // backlog to grandfather in, and a stray any in a test hides a real gap.
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      parser: parserTypeScript,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./tsconfig.test.json']
      }
    },
    plugins: {
      '@typescript-eslint': eslintPluginTypeScript
    },
    rules: {
      ...eslintPluginTypeScript.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn'
    }
  }
]
