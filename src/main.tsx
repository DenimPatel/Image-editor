import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { CrashOnPurpose } from './components/ui/CrashOnPurpose'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { installDiagnostics, reportBoundaryError } from './lib/diagnostics'
import { router } from './router'
import './styles/index.css'

/**
 * First statement, before the app is created.
 *
 * This is the earliest point at which *any* of this app's own code runs: ES
 * module bodies above are evaluated before this one, so a throw while
 * evaluating a static import still reaches nobody. That residual gap is real
 * and is not closed here — closing it needs an inline script in `index.html`,
 * which is this change's to lose. Everything after it is covered, and the
 * browser's own console still holds the rest.
 */
installDiagnostics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside the router as well as inside it: `RouterProvider` itself can
        throw while it builds the route match, and that has to land on the
        crash screen rather than an empty <div id="root">. */}
    {/* `onError` is the prop this boundary has always declared and nothing ever
        passed. It is what puts a React crash into the diagnostics buffer the
        crash screen offers to copy, so the one failure that unmounts the app
        is the one failure with a report attached. */}
    <ErrorBoundary onError={(error, info) => reportBoundaryError(error, info.componentStack)}>
      {/* Dev-only, and stripped from production builds. See the component. */}
      <CrashOnPurpose />
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
)
