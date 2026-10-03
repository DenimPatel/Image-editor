import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { createHarness, resetStores } from '../store/testHarness'
import { TOOL_IDS } from '../store/uiStore'
import Hub from './Hub'

/**
 * The reveal effect is the one thing in the Hub that only exists at runtime: the
 * cards start hidden and an `IntersectionObserver` un-hides each one as it
 * scrolls in. `smoke.test.tsx` renders the page to a string, so it never ran,
 * and the observer stub there made a permanent no-op — every card would have
 * stayed invisible with no test failing. These drive it for real.
 */
class RecordingObserver {
  static instances: RecordingObserver[] = []
  observed: Element[] = []
  unobserved: Element[] = []
  disconnected = false
  private readonly callback: IntersectionObserverCallback
  readonly threshold: number | IntersectionObserverInit['threshold']

  constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
    this.callback = callback
    this.threshold = init?.threshold
    RecordingObserver.instances.push(this)
  }

  observe(el: Element): void {
    this.observed.push(el)
  }

  unobserve(el: Element): void {
    this.unobserved.push(el)
    this.observed = this.observed.filter((node) => node !== el)
  }

  disconnect(): void {
    this.disconnected = true
    this.observed = []
  }

  takeRecords(): [] {
    return []
  }

  /** Fire the callback the way the browser would, for a given entry. */
  enter(...targets: Element[]): void {
    this.callback(
      targets.map(
        (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
      ) as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    )
  }
}

let reduceMotion = false

function setMatchMedia(matches: (query: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches(query)
    },
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const harness = createHarness()

/** A stylesheet with its comments removed, so an explanatory note is not a declaration. */
function declarations(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
const editorCss = readFileSync(
  resolve(process.cwd(), 'src/components/editor/editor.module.css'),
  'utf8',
)

function renderHub() {
  const router = createMemoryRouter([{ path: '/', element: <Hub /> }], {
    initialEntries: ['/'],
  })
  act(() => {
    harness.render(<RouterProvider router={router} />)
  })
  return router
}

beforeEach(() => {
  resetStores()
  RecordingObserver.instances = []
  reduceMotion = false
  setMatchMedia((query) => (query === '(prefers-reduced-motion: reduce)' ? reduceMotion : false))
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = RecordingObserver
})

afterEach(() => harness.unmount())

describe('D8-F14: the hub has a landmark and a way past the nav', () => {
  it('wraps the page content in a single main landmark', () => {
    renderHub()
    const main = harness.container.querySelectorAll('main')
    expect(main).toHaveLength(1)
    expect(main[0]?.id).toBe('main')
  })

  it('the main element is focusable so the skip link can move focus to it', () => {
    renderHub()
    expect(harness.container.querySelector('main')?.getAttribute('tabindex')).toBe('-1')
  })

  it('has exactly one skip link, and it is the first thing in the tab order', () => {
    renderHub()
    const links = Array.from(harness.container.querySelectorAll('a[href="#main"]'))
    expect(links).toHaveLength(1)
    expect(links[0]?.textContent).toBe('Skip to content')
    const focusable = Array.from(harness.container.querySelectorAll('a, button, input, [tabindex]'))
    expect(focusable[0]).toBe(links[0])
  })

  it('the skip link sits before the nav, and #main is only on the main element', () => {
    renderHub()
    const children = Array.from(harness.container.firstElementChild?.children ?? [])
    expect(children[0]?.tagName).toBe('A')
    expect(children[1]?.tagName).toBe('HEADER')
    expect(harness.container.querySelectorAll('#main')).toHaveLength(1)
  })

  it('the skip link is parked off-screen until it takes focus', () => {
    renderHub()
    const link = harness.container.querySelector('a[href="#main"]') as HTMLElement
    // The reveal is a CSS `:focus` rule in the shared stylesheet, not an inline
    // style: the editor's skip link has to reuse exactly the same rule, and an
    // inline style cannot be shared. jsdom does not load `base.css`, so the
    // stylesheet itself is the thing under test here.
    expect(link.style.left).toBe('')
    expect(link.className).toBe('skipLink')
    const css = declarations(readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8'))
    const rule = css.slice(css.indexOf('.skipLink {'))
    // Parked far to the left so it cannot be clicked by accident, and still an
    // ordinary focusable link. The tempting "1px clip instead" rewrite was
    // tried and reverted: Safari does not Tab to *any* link by default, so the
    // clip buys nothing, and it would break `boundingBox().x < -1000`, which is
    // the assertion that the link is genuinely not a mouse target at rest.
    expect(rule.slice(0, rule.indexOf('.skipLink:focus {'))).toMatch(/left:\s*-9999px/)
    expect(rule).toMatch(/\.skipLink:focus \{[^}]*left: 12px/)
  })

  it('the editor reuses the same hiding rule rather than a second copy of it', () => {
    // Two copies of "how to hide a skip link" is how they drift. The reveal
    // offset used to be one of those copies: `base.css` read a token the
    // stylesheet never declared, and the editor hard-coded its own `60px`. Both
    // now read `--ie-skip-top`, so the rule below no longer has to accept the
    // bare literal as a second valid spelling.
    for (const file of ['src/styles/base.css', 'src/components/editor/editor.module.css']) {
      const css = declarations(readFileSync(resolve(process.cwd(), file), 'utf8'))
      const resting = css.slice(css.indexOf('.skipLink {'), css.indexOf('.skipLink:focus {'))
      expect(resting, file).toMatch(/left:\s*-9999px/)
      expect(resting, file).toMatch(/top:\s*var\(--ie-skip-top/)
      expect(resting, file).not.toMatch(/top:\s*[0-9]+px/)
    }
    // And each surface still answers for itself: the token is declared once,
    // defaulted once, and overridden by the editor's taller frame.
    expect(tokensCss).toMatch(/--ie-skip-top:\s*8px;/)
    expect(editorCss).toMatch(/--ie-skip-top:\s*60px;/)
  })

  it('still renders the hub content inside the landmark', () => {
    renderHub()
    const main = harness.container.querySelector('main')
    expect(main?.textContent).toContain('Edit images')
    expect(main?.querySelector('#tools')).not.toBeNull()
    expect(harness.container.querySelector('footer')).not.toBeNull()
  })
})

describe('the hub reveals its cards as they scroll in', () => {
  const revealed = () =>
    Array.from(harness.container.querySelectorAll('.reveal')).filter((node) =>
      node.classList.contains('is-visible'),
    ).length
  const all = () => harness.container.querySelectorAll('.reveal').length

  it('starts with every card hidden, so a card that never reveals is a visible bug', () => {
    renderHub()
    // One section head and eight tool cards.
    expect(all()).toBe(9)
    expect(revealed()).toBe(0)
  })

  it('observes each card and un-hides it when it intersects', () => {
    renderHub()
    const observer = RecordingObserver.instances[0]
    expect(observer).toBeDefined()
    expect(observer.observed).toHaveLength(9)
    const secondCard = harness.container.querySelectorAll('.tool-card')[1]
    observer.enter(secondCard)
    expect(revealed()).toBe(1)
    expect(secondCard?.classList.contains('is-visible')).toBe(true)
  })

  it('stops watching a card it has already revealed', () => {
    renderHub()
    const observer = RecordingObserver.instances[0]
    const card = harness.container.querySelector<HTMLElement>('.tool-card')
    if (!card) throw new Error('no tool card')
    observer.enter(card)
    expect(observer.unobserved).toContain(card)
    // Re-entering must not add a second entry; the browser no longer reports it.
    expect(observer.observed).toHaveLength(8)
  })

  it('leaves a card that has not intersected alone', () => {
    renderHub()
    const observer = RecordingObserver.instances[0]
    observer.enter(harness.container.querySelectorAll<HTMLElement>('.tool-card')[0])
    expect(
      harness.container.querySelectorAll('.tool-card')[1]?.classList.contains('is-visible'),
    ).toBe(false)
  })

  it('reveals everything at once when the visitor asked for reduced motion', () => {
    // With reduced motion the page must not depend on a scroll event to become
    // readable, and it must not create an observer at all.
    reduceMotion = true
    renderHub()
    expect(RecordingObserver.instances).toHaveLength(0)
    expect(revealed()).toBe(all())
  })

  it('disconnects the observer when the page unmounts', () => {
    renderHub()
    const observer = RecordingObserver.instances[0]
    harness.unmount()
    expect(observer.disconnected).toBe(true)
    harness.render(<div />)
  })
})

describe('the hub sends you where the button says it does', () => {
  it('the primary action goes to the editor', () => {
    const router = renderHub()
    const start = Array.from(harness.container.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === 'Start editing',
    ) as HTMLAnchorElement
    expect(start.getAttribute('href')).toBe('/editor')
    act(() => start.click())
    expect(router.state.location.pathname).toBe('/editor')
  })

  it('the secondary action is an in-page jump to the tool list, not a route', () => {
    renderHub()
    const jump = Array.from(harness.container.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === 'See what it can do',
    ) as HTMLAnchorElement
    // `#tools` as a `to` prop must stay on this document. React Router resolves
    // it against the current location, so the rendered href is `/#tools`: the
    // browser treats that as a same-page fragment jump, not a navigation, and
    // the browser's own `#tools` target has to be the thing it lands on.
    expect(jump.getAttribute('href')).toBe('/#tools')
    expect(new URL(jump.href, 'http://x/').hash).toBe('#tools')
    expect(harness.container.querySelector('#tools')).not.toBeNull()
  })

  it('every tool card is a real link to a route that exists', () => {
    const router = renderHub()
    const cards = Array.from(
      harness.container.querySelectorAll('.tool-card'),
    ) as HTMLAnchorElement[]
    expect(cards).toHaveLength(8)
    for (const card of cards) {
      const href = card.getAttribute('href') ?? ''
      expect(href, card.textContent?.slice(0, 30)).toMatch(/^\/editor(\/[a-z]+)?$/)
      expect(card.querySelector('h3')?.textContent?.length).toBeGreaterThan(0)
      // A card is a link, so it needs an accessible name that says where it goes.
      expect(card.textContent).toMatch(/Get started|Open workspace/)
    }
    act(() => cards[0].click())
    expect(router.state.location.pathname).toBe('/editor/crop')
  })

  it('every card names a tool the editor actually has a tab for', () => {
    // The dead route this file was written too late for. `/editor/:tool` matches
    // *any* string, and `Editor` only calls `setActiveTool` for a `ToolId`, so a
    // card pointing at `/editor/transform` resolved, painted the editor with the
    // photo loaded, and opened nothing: no tab marked current, no sheet, no
    // message. The route matched and the destination did not exist, which is why
    // asserting the href *shape* above was not enough on its own — `/editor/
    // transform` is a perfectly well-formed path.
    //
    // `TOOL_IDS` is the list the tab bar is built from, so a card cannot point at
    // a tool the app has dropped without this going red.
    renderHub()
    const hrefs = Array.from(harness.container.querySelectorAll('.tool-card')).map((card) =>
      (card as HTMLAnchorElement).getAttribute('href'),
    )
    const slugs = hrefs
      .filter((href): href is string => typeof href === 'string')
      .map((href) => href.replace('/editor', ''))
      .filter(Boolean)
    expect(slugs.length).toBeGreaterThan(0)
    for (const slug of slugs) {
      expect(TOOL_IDS, `${hrefs.join(' ')} → ${slug}`).toContain(slug.replace('/', ''))
    }
  })

  it('does not advertise a flip the app has no control for', () => {
    // The card that pointed at `/editor/transform` also promised "Flip
    // horizontally or vertically". `toggleFlipV` is in the store and no panel
    // calls it, so the vertical half was a control that does not exist. Rotate
    // and flip are real, and they are real *on the Crop panel* — so the copy that
    // claims them lives on the card that opens them.
    const crop = readFileSync(resolve(process.cwd(), 'src/components/tools/CropPanel.tsx'), 'utf8')
    expect(crop).toMatch(/onClick=\{\(\) => rotateBy\(-90\)\}/)
    expect(crop).toMatch(/onClick=\{\(\) => rotateBy\(90\)\}/)
    expect(crop).toMatch(/onClick=\{toggleFlipH\}/)
    expect(crop).not.toMatch(/toggleFlipV/)

    renderHub()
    const text = harness.container.textContent ?? ''
    expect(text).toMatch(/rotate or flip/)
    expect(text).not.toMatch(/vertically/)
  })

  it('offers exactly one way into the full workspace, and marks it as such', () => {
    renderHub()
    const featured = harness.container.querySelectorAll('.tool-card--featured')
    expect(featured).toHaveLength(1)
    expect(featured[0]?.getAttribute('href')).toBe('/editor')
  })
})

describe('the hub claims it is private, so it must not call anyone', () => {
  it('the page never reaches a third-party origin', () => {
    // "100% client-side", "no uploads, no accounts" and a network panel with a
    // googleapis row are two different stories. The webfont links that used to
    // live in index.html made this false, and nothing in the render asserted
    // otherwise because the strings were never checked against the network.
    renderHub()
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    // A prose mention of the domain in a comment is fine; a `<link>` that
    // fetches from it is the thing that breaks the claim.
    expect(html).not.toMatch(/<(link|script)[^>]+fonts\.(googleapis|gstatic)\.com/i)
    const css = ['base.css', 'hub.css', 'tokens.css']
      .map((file) => readFileSync(resolve(process.cwd(), 'src/styles', file), 'utf8'))
      .join('\n')
    expect(css).not.toMatch(/url\(\s*['"]?https?:/)
  })

  it('declares the display face from the bundled files instead', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8')
    expect(css).toMatch(/@font-face/)
    // The layer fonts live in public/fonts and are already used by the editor.
    expect(css).toContain('/fonts/inter.woff2')
    expect(css).toContain('/fonts/inter-bold.woff2')
    const manifest = readFileSync(resolve(process.cwd(), 'public/manifest.webmanifest'), 'utf8')
    expect(manifest).toContain('"display": "standalone"')
  })
})

describe('the hub footer is a contentinfo landmark, not a div', () => {
  it('is a <footer> outside the main landmark', () => {
    renderHub()
    const footer = harness.container.querySelector('footer')
    expect(footer).not.toBeNull()
    expect(harness.container.querySelector('main')?.contains(footer as Node)).toBe(false)
  })

  it('carries the build identifier, so a bug report can name what it was against', () => {
    renderHub()
    // There was no version anywhere in the UI before this, and `APP_VERSION` was
    // a hardcoded literal that could drift from package.json. `buildLabel()` is
    // stamped at compile time from the same file, so the two cannot diverge.
    const footer = harness.container.querySelector('footer')
    expect(footer?.textContent).toContain('Interactive Image Editor')
    expect(footer?.textContent).toMatch(/\d+\.\d+\.\d+/)
    expect(footer?.textContent).toMatch(/\((?:[0-9a-f]{7,}|unknown)\)/)
  })

  it('links the licences by plain anchor, not by route, and says what it lists', () => {
    renderHub()
    const footer = harness.container.querySelector('footer')
    const link = Array.from(harness.container.querySelectorAll('a')).find((node) =>
      node.getAttribute('href')?.endsWith('licenses.html'),
    )
    expect(link?.textContent).toBe('Licences and attribution')
    // A crash screen is exactly when a route-based page is unavailable, and the
    // crash screen links here too.
    expect(footer?.textContent).toMatch(/14 fonts and 19 software packages/)
    expect(link?.getAttribute('href')).not.toBe('#licenses')
  })
})

describe('the hub does not leave observers or timers behind', () => {
  it('does not install a resize or scroll listener on the body', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    renderHub()
    const listened = addEventListener.mock.calls.map(([type]) => type)
    expect(listened).not.toContain('scroll')
    expect(listened).not.toContain('resize')
    addEventListener.mockRestore()
  })
})
