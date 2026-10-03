import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TITLE, RouteTitle } from './components/ui/RouteTitle'
import { createHarness } from './store/testHarness'
import { routes } from './router'

const harness = createHarness()

afterEach(() => {
  harness.unmount()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function Boom(): JSX.Element {
  throw new Error('route element exploded')
}

describe('D8-F14: per-route document.title', () => {
  it('RouteTitle sets document.title and updates it when the route changes', () => {
    act(() => {
      harness.render(
        <RouteTitle title="Editor — Interactive Image Editor">
          <p>panel</p>
        </RouteTitle>,
      )
    })
    expect(document.title).toBe('Editor — Interactive Image Editor')
    act(() => {
      harness.render(
        <RouteTitle title="Interactive Image Editor — crop, adjust and export in your browser">
          <p>panel</p>
        </RouteTitle>,
      )
    })
    expect(document.title).toBe(
      'Interactive Image Editor — crop, adjust and export in your browser',
    )
    // The page is still rendered; only the title changes.
    expect(harness.container.textContent).toBe('panel')
  })

  it('ships a default title for the first paint before React mounts', () => {
    expect(DEFAULT_TITLE).toBe('Interactive Image Editor')
    expect(readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')).toContain(
      `<title>${DEFAULT_TITLE}</title>`,
    )
  })
})

describe('D8-F06: the route table', () => {
  it('gives every route an errorElement', () => {
    expect(routes.length).toBe(4)
    for (const route of routes) {
      expect(route.errorElement, `route ${route.path} has no errorElement`).toBeTruthy()
    }
  })

  it('gives the Hub and the Editor distinct document titles', () => {
    const elements = routes.map((route) => route.element)
    const titles = elements.map((element) => {
      // The title lives in a RouteTitle wrapper; read it off the element tree
      // rather than importing the pages, which would drag the whole editor in.
      const props = element as { props: { title: string; children: unknown } }
      return props.props.title
    })
    expect(new Set(titles).size).toBe(2)
    expect(titles[0]).toMatch(/crop, adjust and export/)
    expect(titles[1]).toMatch(/^Editor/)
  })

  it('a route element that throws lands on the crash screen with recovery', () => {
    const router = createMemoryRouter(
      [{ path: '/', element: <Boom />, errorElement: routes[0].errorElement }],
      { initialEntries: ['/'] },
    )
    act(() => {
      harness.render(<RouterProvider router={router} />)
    })
    expect(harness.container.querySelector('[role="alert"]')).not.toBeNull()
    const labels = Array.from(harness.container.querySelectorAll('button')).map(
      (button) => button.textContent,
    )
    expect(labels).toContain('Reload')
    // The destructive way out, and it says what it destroys. `RouteError` wires
    // it to `clearSession`, which drops the session row and every asset row —
    // the photo and the edits. A crash screen that offered that as a bare
    // "Start over", directly under a line promising the session was still
    // stored, was asking a user to make the worst available decision on the
    // grounds that the least important word was "over".
    expect(labels).toContain('Start over — deletes your photo and edits')
    expect(harness.container.textContent).toContain(
      'still stored on this device — until you start over, which deletes the photo and the edits together.',
    )
    expect(labels).toContain('Back to the home page')
  })

  it('a 404 from a loader is reported as a 404 rather than a crash', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/editor/bogus',
          // React Router normalises a Response thrown by a loader into its own
          // ErrorResponse, which is what `isRouteErrorResponse` recognises.
          loader: () => {
            throw new Response('no such tool', { status: 404, statusText: 'Not Found' })
          },
          element: <p>never</p>,
          errorElement: routes[0].errorElement,
        },
      ],
      { initialEntries: ['/editor/bogus'] },
    )
    await act(async () => {
      harness.render(<RouterProvider router={router} />)
      await router.state.initialized
    })
    expect(harness.container.querySelector('[role="alert"]')).not.toBeNull()
    expect(harness.container.textContent).toContain('Page not found')
    expect(harness.container.textContent).toContain('Not Found')
  })
})
