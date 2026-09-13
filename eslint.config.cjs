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
      // nested checkouts and tool output land in root dot-dirs the anchored patterns miss
      '.*/**',
      '*.config.*',
      // tsc --build emits .js beside sources, ignore so strays never lint
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
      // rules-of-hooks catches real crashes; exhaustive-deps is advisory
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // error again: backlog is gone bar one documented disable in the collab transport
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn'
    }
  },
  {
    // renderer reaches main only via data/, so screens can be tested against stand-ins
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
    // tests live outside src/ so they need their own parser block; any stays an error
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
