import { Component, type ErrorInfo, type ReactNode } from 'react'
import { buildLabel } from '../../lib/buildInfo'
import { DiagnosticsReport } from './DiagnosticsReport'
import styles from './errorBoundary.module.css'

export type ErrorFallbackProps = {
  title: string
  detail?: string | null
  /** Where the user is, so the copy can name the thing that failed. */
  context?: string
  onReload?: () => void
  onStartOver?: () => void
  onRetry?: () => void
  retryLabel?: string
  /**
   * What the destructive button is called.
   *
   * A prop rather than a fixed string because "Start over" reads as a recovery
   * and is not one: `onStartOver` is wired to `clearSession`, which drops the
   * stored session row *and* the encoded image behind it. That is the user's
   * photograph and every edit made to it, and a button that destroys both while
   * reading as a fresh start is a trap set in the place a person is most likely
   * to press something. So a caller that supplies `onStartOver` supplies the
   * label that names what is lost, and the body below says it a second time for
   * anyone who reads before they click.
   */
  startOverLabel?: string
}

/**
 * The shared crash screen. A throw inside the React tree — a closed
 * `ImageBitmap` handed to the canvas, a shader that failed to compile, a tool
 * panel — used to unmount the whole app to a white page with nothing but a
 * console stack, so every crash surface has to offer a way out rather than
 * only a reload.
 *
 * The build identifier and the licences link are here for the same reason. A
 * user whose app broke is exactly the person who needs to tell you what they
 * were running, and this is the only screen they can still read. The link is a
 * plain anchor to a static file rather than a route: the router may be part of
 * what is broken, and a link that goes through it would fail exactly when it is
 * needed.
 */
export function ErrorFallback({
  title,
  detail,
  context,
  onReload,
  onStartOver,
  onRetry,
  retryLabel = 'Try again',
  startOverLabel = 'Start over',
}: ErrorFallbackProps) {
  return (
    <div className={styles.crash} role="alert">
      <div className={styles.crashPanel}>
        <h1 className={styles.crashTitle}>{title}</h1>
        {context && <p className={styles.crashContext}>{context}</p>}
        {/* The reassurance and the warning are the same sentence, because they
            are the same fact: the session is still here, and one of the three
            buttons below is what takes it. Stating only the first half put "your
            last autosaved session is still stored" directly above a control that
            erases it. */}
        <p className={styles.crashBody}>
          Nothing was uploaded, and your last autosaved session is still stored on this device
          {onStartOver
            ? ' — until you start over, which deletes the photo and the edits together.'
            : '.'}
        </p>
        <div className={styles.crashActions}>
          {onRetry && (
            <button type="button" className={styles.crashPrimary} onClick={onRetry}>
              {retryLabel}
            </button>
          )}
          {onStartOver && (
            <button type="button" className={styles.crashButton} onClick={onStartOver}>
              {startOverLabel}
            </button>
          )}
          {onReload && (
            <button type="button" className={styles.crashButton} onClick={onReload}>
              Reload
            </button>
          )}
        </div>
        {detail && (
          <details className={styles.crashDetails}>
            <summary>Technical details</summary>
            <pre className={styles.crashPre}>{detail}</pre>
            {/* The copy action lives inside the disclosure rather than in the
                action row, because the action row is three ways *out* of a
                broken app and this is not one of them — it is the one thing a
                reader does while still stuck here. It renders nothing without
                a `detail`, which is the 404 case: a URL that does not exist is
                not a bug worth a report. */}
            <DiagnosticsReport />
          </details>
        )}
        <p className={styles.crashDetails}>
          {/* `--crashDetails` is reused rather than a new class added: this
              stylesheet is not this change's to grow, and the existing rule is
              already the right size, colour and spacing for a quiet closing
              line. The link takes the accent token inline because a bare
              `<a>` takes the UA's light-mode blue, which is the 1.49:1
              failure the Pexels credit link already had to be corrected for. */}
          <a
            href={`${import.meta.env.BASE_URL}licenses.html`}
            style={{ color: 'var(--ie-accent-bright, var(--accent))' }}
          >
            Licences and attribution
          </a>
          <span aria-hidden="true"> · </span>
          <span>{buildLabel()}</span>
        </p>
      </div>
    </div>
  )
}

export type ErrorBoundaryProps = {
  children: ReactNode
  /** Rendered instead of the children after a crash. */
  fallback?: (props: { error: Error; retry: () => void }) => ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
}

type ErrorBoundaryState = { error: Error | null }

/**
 * Class component on purpose: `getDerivedStateFromError` and
 * `componentDidCatch` have no hook equivalent, and a boundary that is itself a
 * function component cannot catch its own render errors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  private readonly retry = () => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback({ error, retry: this.retry })
    return (
      <ErrorFallback
        title="Something went wrong"
        detail={`${error.name}: ${error.message}`}
        // It used to claim the app failed while booting. This boundary wraps
        // the whole app for the whole session, not just the start, so a panel
        // that threw two minutes into an edit was told it had failed to load.
        // It names no moment now, because it cannot know which one broke.
        context="A part of the editor could not finish rendering."
        onReload={() => window.location.reload()}
        onRetry={this.retry}
        retryLabel="Try again"
      />
    )
  }
}
