import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['.worktrees/**', 'dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.node,
        Bun: 'readonly',
      },
      sourceType: 'module',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'components/**/*.tsx'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['components/ui-kit/**/*.tsx'],
    rules: {
      'prefer-const': 'off',
    },
  },
  prettier
)
