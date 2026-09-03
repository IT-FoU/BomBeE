import js from '@eslint/js';
import { flatConfigs as importX } from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const browserApps = ['apps/customer/**/*.{ts,tsx}', 'apps/backoffice/**/*.{ts,tsx}'];
const nodePackages = [
  'apps/api/**/*.{ts,tsx}',
  'packages/shared/**/*.{ts,tsx}',
  'packages/config/**/*.{ts,tsx}',
  'eslint.config.js',
  'vitest.workspace.ts',
];

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.vite/**',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    ...importX.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import-x/no-cycle': 'error',
      'import-x/no-unresolved': 'off',
    },
  },
  {
    files: browserApps,
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bombee/api', '@bombee/api/*', '**/apps/api/**'],
              message: 'UI apps must not import API internals. Use HTTP contracts or @bombee/shared.',
            },
          ],
        },
      ],
    },
  },
  {
    files: nodePackages,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
];
