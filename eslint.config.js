// eslint.config.js — Solid migration baseline (M0.4).
//
// Flat config, kept deliberately minimal. The audit's lean-code rules
// boil down to: no dead code, no implicit any (already enforced by
// tsc with the M0.4 strict flags), no `==` quirks, no stray console
// in production code.
//
// Run with: `npx eslint .`
//
// Philosophy: TypeScript's strict mode does most of our type-shape
// work. ESLint is here for stylistic rules tsc doesn't enforce.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', '*.config.{js,cjs,mjs,ts}'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        crypto: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
      },
    },
    rules: {
      // Always === / !==.
      eqeqeq: ['error', 'always'],
      // Don't shadow built-ins or outer scope.
      'no-shadow': 'off',
      // Production code: console.log forbidden, but warn/error allowed.
      // src/lib/log.ts is the wrapper everyone should use.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Unused locals already caught by tsc (M0.4); leave off here so we
      // don't double-warn during migration.
      'no-unused-vars': 'off',
      // TS handles undef.
      'no-undef': 'off',
      // Prefer const for never-reassigned variables.
      'prefer-const': 'error',
      // No-op statements probably mean stale code.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // TS handles unused-vars; turn off the @ts-eslint one too so
      // we don't double-warn while components are work-in-progress.
      '@typescript-eslint/no-unused-vars': 'off',
      // The scaffold uses some `any` in transport code; tighten in
      // M1.2 not here.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // The log wrapper IS the abstraction — it's the one place
    // allowed to call console directly. M8.2 sweeps everyone else.
    files: ['src/lib/log.ts'],
    rules: { 'no-console': 'off' },
  },
);
