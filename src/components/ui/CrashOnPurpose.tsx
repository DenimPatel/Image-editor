import type { ReactNode } from 'react'

/**
 * A deliberate render-time throw, reachable at `?crash=1`.
 *
 * The root error boundary had a unit test and nothing else, which is not
 * evidence that it works: a boundary can pass a jsdom harness and still leave a
 * real page blank, because the real one is mounted outside a `RouterProvider`,
 * under `StrictMode`, with lazy routes and a Suspense boundary above it. The e2e
 * suite needs a way to make a genuine page throw, and no user action in this
 * app does it on demand.
 *
 * `import.meta.env.DEV` is statically `false` in a production build, so Rollup
 * drops this component and the branch that renders it — the flag cannot be
 * reached in a shipped bundle.
 */
export function CrashOnPurpose(): ReactNode {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('crash') === '1') {
    throw new Error('Deliberate test crash (?crash=1)')
  }
  return null
}
