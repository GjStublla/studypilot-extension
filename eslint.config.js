import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const sourceFiles = ['src/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs}', 'e2e/**/*.{js,mjs,ts}', '*.config.{js,mjs,ts}'];

const nodeFiles = ['scripts/**/*.{js,mjs}', 'e2e/**/*.{js,mjs,ts}', '*.config.{js,mjs,ts}'];

const browserFiles = ['src/**/*.{ts,tsx}', 'e2e/**/*.{js,mjs,ts}'];

export default [
  {
    ignores: [
      'dist/**',
      'dist-local/**',
      'node_modules/**',
      'test-results/**',
      'dist-tsbuildinfo/**',
      'src/dev/preview.html',
    ],
  },
  { files: sourceFiles, ...js.configs.recommended },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: sourceFiles,
  })),
  {
    files: browserFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
    },
  },
  {
    files: nodeFiles,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: sourceFiles,
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['e2e/**/*.{js,mjs,ts}'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
];
