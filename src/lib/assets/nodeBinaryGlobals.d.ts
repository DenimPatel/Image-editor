/**
 * `node:fs` as the shipped-asset tests need it: the 1-argument, binary-returning
 * form of `readFileSync`.
 *
 * `src/components/ui/nodeTestGlobals.d.ts` and `src/model/nodeTestGlobals.d.ts`
 * already declare a narrow ambient `node:fs` so the browser-only app program
 * does not have to pull `@types/node` in and silently widen every other file's
 * globals. Those two cover text reads, which is all their tests need. Decoding a
 * PNG or hashing a woff2 needs bytes, so this adds the missing overload rather
 * than editing files this district does not own. Ambient module declarations
 * merge, so `readFileSync(path, 'utf8')` keeps returning `string` for them.
 */
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array
}
