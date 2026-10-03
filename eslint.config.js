import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.kilo', 'public', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Restored to error now that Editor.tsx no longer derives state in effects.
      'react-hooks/set-state-in-effect': 'error',
    },
  },
  {
    // scripts/*.mjs is Node, not the browser, and is not TypeScript. Before this
    // block it matched no config at all, so a typo in the build step that gates
    // the shipped assets was invisible to both `npm run lint` and `tsc -b`.
    // Public service workers are deliberately excluded: they are deployed as
    // plain static files with no build step to bundle them.
    files: ['scripts/**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // e2e/** is Playwright, not React. `react-hooks/rules-of-hooks` reads every
    // call named `use` as a hook, and Playwright's `test.extend` fixtures are
    // all `async ({ page }, use) => …` — twelve false errors that would make
    // `npm run lint` permanently red. The rest of the React rules are kept:
    // they cost nothing here and would catch a copy-pasted component.
    files: ['e2e/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
)
