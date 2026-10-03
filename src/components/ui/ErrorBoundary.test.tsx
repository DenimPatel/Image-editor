import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness } from '../../store/testHarness'
import { ErrorBoundary, ErrorFallback } from './ErrorBoundary'

const harness = createHarness()

function Boom({ label = 'boom' }: { label?: string }): JSX.Element {
  throw new Error(label)
}

afterEach(() => harness.unmount())

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ErrorFallback', () => {
  it('offers Reload, a retry and Start over when the handlers exist', () => {
    let reloaded = 0
    let started = 0
    let retried = 0
    act(() => {
      harness.render(
        <ErrorFallback
          title="Something went wrong"
          context="While loading"
          detail="TypeError: nope"
          onReload={() => (reloaded += 1)}
          onStartOver={() => (started += 1)}
          onRetry={() => (retried += 1)}
        />,
      )
    })
    const labels = Array.from(harness.container.querySelectorAll('button')).map(
      (button) => button.textContent,
    )
    // Exact equality, as before, and now including the copy action. A crash
    // screen a user cannot get a report out of is the failure this whole module
    // exists to close, so the button list is pinned rather than opened up to a
    // `toContain`.
    expect(labels).toEqual(['Try again', 'Start over', 'Reload', 'Copy diagnostics'])
    expect(harness.container.querySelector('[role="alert"]')).not.toBeNull()
    expect(harness.container.textContent).toContain('TypeError: nope')

    const click = (text: string) => {
      const button = Array.from(harness.container.querySelectorAll('button')).find(
        (node) => node.textContent === text,
      )
      if (!button) throw new Error(`no button ${text}`)
      act(() => button.click())
    }
    click('Reload')
    click('Start over')
    click('Try again')
    expect([reloaded, started, retried]).toEqual([1, 1, 1])
  })

  it('hides the technical details when there is nothing to show', () => {
    act(() => harness.render(<ErrorFallback title="Broken" />))
    expect(harness.container.querySelector('details')).toBeNull()
  })

  it('warns about the loss in the body as well as on the button', () => {
    // The button label is read by someone scanning the row of controls; the body
    // is read by someone reading the screen top to bottom. The claim "your
    // session is still stored" sits immediately above a control that deletes it,
    // so the sentence that makes it has to finish the thought.
    act(() =>
      harness.render(
        <ErrorFallback
          title="Broken"
          onStartOver={() => undefined}
          startOverLabel="Start over — deletes your photo and edits"
        />,
      ),
    )
    expect(harness.container.textContent).toContain(
      'still stored on this device — until you start over, which deletes the photo and the edits together.',
    )
    // And with no destructive button on the screen there is nothing to warn
    // about, so the sentence stays the plain reassurance it used to be.
    act(() => harness.render(<ErrorFallback title="Broken" />))
    expect(harness.container.textContent).toContain('still stored on this device.')
    expect(harness.container.textContent).not.toContain('until you start over')
  })

  it('offers the licences and the build identifier, which is what a crash report needs', () => {
    act(() => harness.render(<ErrorFallback title="Broken" />))
    const link = harness.container.querySelector<HTMLAnchorElement>('a')
    // A plain anchor, not a router `Link`: the router may be part of what broke,
    // and a link that goes through it fails exactly when it is needed.
    expect(link?.getAttribute('href')).toMatch(/licenses\.html$/)
    expect(link?.textContent).toBe('Licences and attribution')
    // The version is the other half of a reproducible report, and there was no
    // version anywhere in the UI before this.
    expect(harness.container.textContent).toMatch(/\d+\.\d+\.\d+/)
    expect(harness.container.textContent).toMatch(/\((?:[0-9a-f]{7,}|unknown)\)/)
  })
})

describe('ErrorBoundary', () => {
  it('D8-F06: a throwing child renders the crash screen, not a blank page', () => {
    act(() => {
      harness.render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
    })
    expect(harness.container.querySelector('[role="alert"]')).not.toBeNull()
    expect(harness.container.textContent).toContain('Something went wrong')
    expect(harness.container.textContent).toContain('Error: boom')
  })

  it('reports the error to onError with the component stack', () => {
    const seen: { message: string; hasStack: boolean }[] = []
    act(() => {
      harness.render(
        <ErrorBoundary
          onError={(error, info) =>
            seen.push({ message: error.message, hasStack: Boolean(info.componentStack) })
          }
        >
          <Boom label="shader failed" />
        </ErrorBoundary>,
      )
    })
    expect(seen).toHaveLength(1)
    expect(seen[0].message).toBe('shader failed')
    expect(seen[0].hasStack).toBe(true)
  })

  it('Try again re-renders the children instead of staying on the crash screen', () => {
    let shouldThrow = true
    function Maybe(): JSX.Element {
      if (shouldThrow) throw new Error('transient')
      return <p>recovered</p>
    }
    act(() => {
      harness.render(
        <ErrorBoundary>
          <Maybe />
        </ErrorBoundary>,
      )
    })
    expect(harness.container.querySelector('[role="alert"]')).not.toBeNull()
    shouldThrow = false
    const retry = Array.from(harness.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Try again',
    )
    act(() => retry?.click())
    expect(harness.container.querySelector('[role="alert"]')).toBeNull()
    expect(harness.container.textContent).toBe('recovered')
  })

  it('renders children untouched while nothing throws', () => {
    act(() => {
      harness.render(
        <ErrorBoundary>
          <p>all good</p>
        </ErrorBoundary>,
      )
    })
    expect(harness.container.textContent).toBe('all good')
  })

  it('accepts a custom fallback', () => {
    act(() => {
      harness.render(
        <ErrorBoundary fallback={({ error }) => <p>custom: {error.message}</p>}>
          <Boom label="x" />
        </ErrorBoundary>,
      )
    })
    expect(harness.container.textContent).toBe('custom: x')
  })
})
