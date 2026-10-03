import { useCallback } from 'react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'
import { clearSession } from '../../lib/persist/session'
import { ErrorFallback } from './ErrorBoundary'

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

  const startOver = useCallback(() => {
    // The persisted session is the one piece of state that survives a reload,
    // so "start over" has to drop it or the same broken document comes
    // straight back. Everything else lives in module state and resets on
    // navigation.
    void clearSession()
      .catch(() => undefined)
      .finally(() => navigate('/editor', { replace: true }))
  }, [navigate])

  return (
    <ErrorFallback
      title={info.title}
      context={info.context}
      detail={info.detail}
      onStartOver={startOver}
      // The label names the two things `clearSession` takes, in the words the
      // resume card uses for the same gesture ("photo and the edits together"),
      // so a user meeting the button in both places is not told two different
      // stories about what a press costs them.
      startOverLabel="Start over — deletes your photo and edits"
      onReload={() => window.location.reload()}
      onRetry={() => navigate('/', { replace: true })}
      retryLabel="Back to the home page"
    />
  )
}
