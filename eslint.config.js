'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const prettier = require('eslint-config-prettier');

/** Shared rules, whichever half of the plugin the file belongs to. */
const common = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  // Swallowing an error on purpose is a pattern here: blocked storage, a locale
  // with no catalogue, a malformed href. The comment inside says why.
  'no-empty': ['error', { allowEmptyCatch: true }],
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': 'error',
  'object-shorthand': 'error',
  'no-console': ['warn', { allow: ['warn', 'error'] }],
};

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'docs/**'] },

  js.configs.recommended,

  // Server: CommonJS on Node.
  {
    files: ['server/**/*.js', '*.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: common,
  },

  // Admin: ES modules in the browser, with JSX.
  {
    files: ['admin/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: '18.0' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs['recommended-latest'].rules,
      ...common,
      // The components here are small and internal; prop types would be noise.
      'react/prop-types': 'off',
    },
  },

  // Tests: ES modules on Node, and they report by printing.
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...common, 'no-console': 'off' },
  },

  prettier,
];
