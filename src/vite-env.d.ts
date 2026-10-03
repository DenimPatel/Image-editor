/// <reference types="vite/client" />

/**
 * `src/vite-env.d.ts` is the app project's home for injected globals, but
 * `buildInfo.ts` is also compiled by `tsconfig.node.json` — `e2e/**` imports
 * `src/model/defaults.ts`, which imports this module, and that project sets
 * `types: ["node"]` with no `vite/client` reference. A declaration that only
 * exists in `vite-env.d.ts` is therefore invisible in the project that
 * actually typechecks the reader, and `tsc -b` fails on a symbol that is
 * perfectly well defined for the bundler. So the declarations live next to
 * their only consumer; `buildInfo.ts` re-exports them for anyone else.
 */
export {}
