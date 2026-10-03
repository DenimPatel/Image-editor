/**
 * The app tsconfig is browser-only (`lib: ["ES2020", "DOM"]`, no `types` beyond
 * `vitest/globals`), but a few tests have to read the shipped CSS and the
 * shipped `index.html` as text: the layout, focus-ring, forced-colors and
 * head-tag fixes are all CSS/HTML-only and cannot be proved by rendering.
 *
 * Vitest runs in Node, so `node:fs` resolves at runtime. These declarations
 * give those tests a type without pulling `@types/node` into the whole program
 * and silently widening every other file's globals.
 */

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function existsSync(path: string): boolean
}

declare module 'node:path' {
  export function resolve(...parts: string[]): string
}

declare const process: { cwd(): string }
