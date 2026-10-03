/**
 * Additions to the ambient `node:fs` / `node:path` declarations in
 * `src/components/ui/nodeTestGlobals.d.ts`. Ambient module declarations merge
 * across files, so this only has to supply the members that one does not
 * already declare — which is why `readFileSync`, `existsSync`, `resolve` and
 * `process` are deliberately absent here.
 *
 * The app tsconfig is browser-only, and pulling `@types/node` into the whole
 * program to walk a directory tree would silently widen every other file's
 * globals. `defaults.test.ts` uses these to scan the sources for a second copy
 * of the schema number, which no type-level check can catch.
 */

declare module 'node:fs' {
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[]
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function relative(from: string, to: string): string
}
