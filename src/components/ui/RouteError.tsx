import { useCallback } from 'react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'
import { ConfirmDialog } from './ConfirmDialog'
import { ErrorFallback } from './ErrorBoundary'
import { confirmThen, startOverRequest } from '../../lib/destructive'
import { forgetStoredDocument } from '../../lib/persist/forget'

function describe(error: unknown): { title: string; context: string; detail: string | null } {
  if (isRouteErrorResponse(error)) {
    return {
      title: error.status === 404 ? 'Page not found' : `Error ${error.status}`,
      context: typeof error.statusText === 'string' ? error.statusText : '',
      detail: error.data === undefined ? null : String(error.data),
    }
  }
  if (error instanceof Error) {
    return {
      title: 'This page could not be shown',
      context: 'Something on this page failed to render.',
      detail: `${error.name}: ${error.message}`,
    }
  }
  return { title: 'This page could not be shown', context: '', detail: String(error) }
}

/**
 * `errorElement` for every route. `useRouteError` is only valid inside a route
 * error boundary, so this is the one place the router can report a failure
 * without taking the whole document down with it.
 */
export function RouteError() {
  const error = useRouteError()
  const navigate = useNavigate()
  const info = describe(error)

  const startOver = useCallback(async () => {
    // The persisted session is the one piece of state that survives a reload,
    // so "start over" has to drop it or the same broken document comes
    // straight back. Everything else lives in module state and resets on
    // navigation.
    //
    // It asks, because this is the one control in the app that deletes a stored
    // photograph *and* its edits in a single press, and the crash screen is
    // exactly where someone reaches for a button without reading it. `forgetStoredDocument`
    // clears the mirror with it — `resolveResumableSession` prefers a stored row over
    // an older mirror and refuses a mirror whose row is missing, so a surviving row
    // would be adopted as-is and the reload would re-offer the photograph this
    // button is supposed to be deleting.
    //
    // The count is 0 rather than read from the store: a crash here is frequently
    // "the store cannot produce this document", and `useDocStore.getState()` on a
    // half-initialised module is the same import that can throw. A wrong number in
    // a confirmation body is a far smaller failure than a second crash inside the
    // handler meant to be getting you out, and `countEdits(undefined)` — the honest
    // answer for "cannot read it" — is 0.
    await confirmThen(startOverRequest(0), async () => {
      await forgetStoredDocument()
      // The store is a module singleton that outlives the route, so clearing the
      // durable copies is not enough: navigating back into `/editor` remounts the
      // page on the *same* document, the render raises for the same reason, and the
      // button that says "deletes your photo and edits" puts the error screen back
      // on top of itself. It has to be emptied here too.
      //
      // Both imports are dynamic, and that is not a micro-optimisation: a crash
      // screen is exactly when the module graph may be the thing that failed, and
      // `RouteError` is in the entry chunk's graph, so a static import of the store
      // would make the crash screen unable to load because of the crash. It also
      // keeps the entry chunk from growing by whatever `docStore` pulls in.
      const [{ useDocStore }, { createDoc }] = await Promise.all([
        import('../../store/docStore'),
        import('../../model/defaults'),
      ])
      useDocStore.getState().load(createDoc())
      navigate('/editor', { replace: true })
    })
  }, [navigate])

  return (
    <>
      <ErrorFallback
        title={info.title}
        context={info.context}
        detail={info.detail}
        onStartOver={() => void startOver()}
        // The label names the two things `forgetStoredDocument` takes, in the words
        // the resume card uses for the same gesture ("photo and the edits
        // together"), so a user meeting the button in both places is not told two
        // different stories about what a press costs them.
        startOverLabel="Start over — deletes your photo and edits"
        onReload={() => window.location.reload()}
        onRetry={() => navigate('/', { replace: true })}
        retryLabel="Back to the home page"
      />
      {/* Mounted here, not relied on from the editor: `RouteError` renders *instead
          of* the page that threw, so the editor's own `<ConfirmDialog>` is unmounted
          by the time this screen exists. Without this the `confirmDestructive` in
          `startOver` resolves `false` — refusing when nothing is mounted is the
          documented safety behaviour — and the one button on this screen that
          destroys something would silently do nothing. */}
      <ConfirmDialog />
    </>
  )
}
