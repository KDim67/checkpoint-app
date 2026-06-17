// @ts-check
const eslintPluginTypeScript = require('@typescript-eslint/eslint-plugin')
const parserTypeScript = require('@typescript-eslint/parser')

module.exports = [
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', '*.config.*']
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
