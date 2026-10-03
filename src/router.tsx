import { Suspense, lazy } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { RouteError } from './components/ui/RouteError'
import { RouteTitle } from './components/ui/RouteTitle'

const HUB_TITLE = 'Interactive Image Editor — crop, adjust and export in your browser'
const EDITOR_TITLE = 'Editor — Interactive Image Editor'

/**
 * D9-F08 — route-level code splitting.
 *
 * Both routes were statically imported, so the entry chunk carried the whole
 * tool graph: `PassportPanel` → `jspdf` (405 kB) and `BackgroundPanel` →
 * `@imgly/background-removal` + `onnxruntime-web` (865 kB of JS plus a 23.9 MB
 * WASM binary). A visitor who only ever read the Hub downloaded all of it.
 *
 * `lazy` moves each page behind a dynamic import, so Rollup emits them as
 * separate chunks fetched on navigation. Nothing in `src/` outside this file
 * needed to change: both pages already default-export a component.
 */
const Hub = lazy(() => import('./pages/Hub'))
const Editor = lazy(() => import('./pages/Editor'))

/**
 * The affordance a lazy route needs. It has to be more than a spinner, because
 * the Editor chunk is the one people wait on deliberately: it mounts straight
 * into the import screen, so a named "Loading the editor" beat reads as
 * progress rather than as a hang. `aria-busy` plus a live region means a screen
 * reader is told too, instead of announcing nothing at all. The classes are
 * global (`base.css`) because the rule has to work on a page that has not
 * mounted its own CSS modules yet — which is the only moment this renders.
 */
function lazyRoute(path: string, title: string, Page: typeof Hub, label: string): RouteObject {
  return {
    path,
    element: (
      <RouteTitle title={title}>
        <Suspense
          fallback={
            <div className="route-fallback" role="status" aria-live="polite" aria-busy="true">
              <span className="route-fallback-dot" aria-hidden="true" />
              <span className="route-fallback-label">{label}</span>
            </div>
          }
        >
          <Page />
        </Suspense>
      </RouteTitle>
    ),
    errorElement: <RouteError />,
  }
}

export const routes: RouteObject[] = [
  lazyRoute('/', HUB_TITLE, Hub, 'Loading'),
  lazyRoute('/editor', EDITOR_TITLE, Editor, 'Loading the editor'),
  lazyRoute('/editor/:tool', EDITOR_TITLE, Editor, 'Loading the editor'),
  // React Router matches `*` last, so the catch-all keeps the Hub's own title
  // for an unknown path.
  lazyRoute('*', HUB_TITLE, Hub, 'Loading'),
]

export const router = createBrowserRouter(routes, { basename: import.meta.env.BASE_URL })
