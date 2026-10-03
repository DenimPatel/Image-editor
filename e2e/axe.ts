import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * The scan, separated from the assertions so every surface in this suite is
 * scanned the same way and so the defects below are fixed in one place.
 */

/** WCAG 2.1 A/AA, and nothing else. axe's `best-practice` tag is not a standard. */
export const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

export type AxeNode = { target: string[]; failureSummary?: string; html?: string }
export type AxeViolation = {
  id: string
  impact: string | null
  help: string
  description?: string
  nodes: AxeNode[]
}

export type ScannedViolation = AxeViolation & {
  /** Which scroll stop the node was visible at, so a repro can be followed. */
  scrollAt: number
}

/**
 * One scroll position for the whole surface: every scroller at the top except
 * one, which is at a given offset.
 */
type ScrollPlan = { scroller: number; top: number }[]

/**
 * Every scroll position axe has to be run at to see the whole surface.
 *
 * This exists because of a green gate over a red page. axe does not evaluate
 * `color-contrast` for content it cannot see: on the import screen the Pexels
 * credit sits at y=866 in a 1280x720 viewport, 146px below the fold, so the scan
 * reported nothing while the link measured 1.99:1 — the light-mode UA link blue
 * `#0000ee` on the editor's `#121214` ground. The gate was not wrong about
 * anything it looked at; it had not looked.
 *
 * And the scroller is not the document. The editor is `position: fixed; inset:
 * 0`, so `document.documentElement.scrollHeight` is always the viewport and a
 * scan that scrolled the window would have found the same nothing twice. The
 * import screen scrolls inside a `<main>`; the Hub scrolls the document. Both are
 * in the list above and each gets its own set of passes.
 */
async function scrollPlans(page: Page): Promise<ScrollPlan[]> {
  return page.evaluate(() => {
    const scrollers: Element[] = []
    const root = document.scrollingElement
    if (root && root.scrollHeight > window.innerHeight + 4) scrollers.push(root)
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const overflowY = getComputedStyle(element).overflowY
      if (!/^(auto|scroll|overlay)$/.test(overflowY)) continue
      if (element.scrollHeight > element.clientHeight + 4 && element.clientHeight > 0) {
        scrollers.push(element)
      }
    }
    const plans: { scroller: number; top: number }[][] = [[]]
    scrollers.forEach((scroller, index) => {
      const start = scroller.scrollTop
      const last = scroller.scrollHeight - scroller.clientHeight
      const tops = [0]
      // A viewport at a time, so no stop can hide a node the previous one showed.
      for (let top = scroller.clientHeight; top <= last + 4; top += scroller.clientHeight) {
        tops.push(Math.min(top, last))
      }
      if (start !== 0) tops.unshift(start)
      for (const top of tops) plans.push([{ scroller: index, top }])
    })
    return plans
  })
}

async function applyPlan(page: Page, plan: ScrollPlan) {
  await page.evaluate((plan) => {
    const scrollers: Element[] = []
    const root = document.scrollingElement
    if (root && root.scrollHeight > window.innerHeight + 4) scrollers.push(root)
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const overflowY = getComputedStyle(element).overflowY
      if (!/^(auto|scroll|overlay)$/.test(overflowY)) continue
      if (element.scrollHeight > element.clientHeight + 4 && element.clientHeight > 0) {
        scrollers.push(element)
      }
    }
    const wanted = new Map(plan.map((step) => [step.scroller, step.top]))
    scrollers.forEach((scroller, index) => {
      scroller.scrollTop = wanted.get(index) ?? 0
    })
  }, plan)
}

/**
 * Wait for every animation and transition on the page to finish, *including the
 * ones a scroll has only just started*.
 *
 * axe samples pixels at the instant it runs, and the hub's tool cards are inside
 * a 0.6s `opacity` reveal that an `IntersectionObserver` starts when they scroll
 * into view (`hub.css:189-200`, `Hub.tsx`). Scan a stop the moment it is reached
 * and axe measures a *fade*, not a colour: at scroll stop 2 it read `--ink-soft`
 * at `#858581` instead of `#4a4a46` and `--accent-ink` at `#617d76` instead of
 * `#143f35` and reported 3.64:1 and 4.38:1 for a page whose resting values are
 * 7.4:1 and 11.2:1. In the other direction, scan too early again — before the
 * observer's callback has run — and there is no animation to wait for yet, so the
 * scan reads `#e1e1df` on `#fbfbf9` at 1.26:1. That is worse than the first one,
 * because 1.26:1 looks like a real defect and would be fixed as one.
 *
 * A single `getAnimations()` call is not enough for either: the observer's
 * callback runs after the scroll's frame and the transition it starts is created
 * in the style-recalc step after *that*, so two frames after a scroll the reveal
 * genuinely has no animation object yet. Concluding "nothing is animating" from
 * that is what reads 1.06:1. So this requires three consecutive rounds that find
 * nothing running, which is the condition "the observer has fired, its fade has
 * landed, and the page is now still" rather than the condition "no animation
 * exists yet".
 *
 * A card that is never revealed stays `opacity: 0`, and axe correctly does not
 * judge invisible content, so the bound only has to outlast the 0.6s reveal and
 * the observer's own latency.
 */
const MAX_SETTLE_ROUNDS = 16
const IDLE_ROUNDS_BEFORE_SETTLED = 3
const MAX_REVEAL_ROUNDS = 40

async function settleAnimations(page: Page) {
  let idle = 0
  for (let round = 0; round < MAX_SETTLE_ROUNDS && idle < IDLE_ROUNDS_BEFORE_SETTLED; round++) {
    const stillRunning = await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const running = document
        .getAnimations()
        .filter((animation) => animation.playState === 'running')
      await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      return document.getAnimations().some((animation) => animation.playState === 'running')
    })
    idle = stillRunning ? 0 : idle + 1
  }

  // Then the Hub's own condition, stated as a condition rather than as a
  // duration. `.reveal` is `opacity: 0` until an `IntersectionObserver` in
  // `Hub.tsx` decides the card is worth showing, and nothing else in the app
  // waits on it. `getAnimations()` is the wrong instrument for "has the observer
  // fired yet" — two frames after a scroll the transition genuinely does not
  // exist — and a duration is the wrong instrument for anything: under five
  // parallel workers a 0.6s fade does not finish inside a fixed budget, and this
  // scan returned 1.06:1 and 3.64:1 for a page whose resting values are 12.3:1 and
  // 11.2:1. Asking the question directly is both faster and correct under load.
  for (let round = 0; round < MAX_REVEAL_ROUNDS; round++) {
    const pending = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.reveal')).some((element) => {
        const box = element.getBoundingClientRect()
        const onScreen =
          box.bottom > 0 &&
          box.top < window.innerHeight &&
          box.right > 0 &&
          box.left < window.innerWidth
        if (!onScreen) return false
        return parseFloat(getComputedStyle(element).opacity) < 1
      }),
    )
    if (!pending) return
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
  }
}

/** How many times a scroll stop that produced findings is re-scanned. */
const CONFIRM_ATTEMPTS = 2

/**
 * axe over every scroll position of the surface, with the violations from each
 * stop merged and tagged with the stop they were seen at.
 *
 * A finding has to *reproduce*. Under the full suite's contention — five workers
 * of WebKit each holding a dozen axe runs — a scan taken while the hub's 0.6s
 * reveal is mid-flight reported eight surfaces at 1.06:1 to 3.64:1 for text whose
 * resting values are 12.3:1, and passed identically when the same file ran on its
 * own. That is not a flaky assertion, it is a measurement that had not settled,
 * and re-running the *same stop* is the only way to tell those apart from a real
 * defect: a real one is there every time. So each stop that produced anything is
 * scanned again and only findings that survive are returned — which also means the
 * cost is paid only when there is something to confirm.
 */
export async function scanWholeSurface(page: Page): Promise<ScannedViolation[]> {
  const plans = await scrollPlans(page)
  const runStop = async (index: number) => {
    await applyPlan(page, plans[index] as ScrollPlan)
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
    await settleAnimations(page)
    const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze()
    return (results.violations as unknown as AxeViolation[]).map((violation) => ({
      ...violation,
      scrollAt: index,
    }))
  }

  const confirmed = new Map<string, ScannedViolation>()
  const seenAt = new Map<number, Set<string>>()
  for (const [index] of plans.entries()) {
    const found = await runStop(index)
    seenAt.set(index, new Set(found.map((violation) => keyOf(violation))))
    for (const violation of found) confirmed.set(keyOf(violation), violation)
  }

  for (const [index, keys] of seenAt) {
    if (keys.size === 0) continue
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
      const again = await runStop(index)
      const now = new Set(again.map((violation) => keyOf(violation)))
      for (const key of keys) {
        if (!now.has(key)) confirmed.delete(key)
      }
      for (const key of now) {
        if (!keys.has(key))
          confirmed.set(key, again.find((v) => keyOf(v) === key) as ScannedViolation)
      }
    }
  }

  await applyPlan(page, plans[0] ?? [])
  return [...confirmed.values()]
}

const keyOf = (violation: ScannedViolation): string =>
  `${violation.id}::${violation.nodes.map((node) => node.target.join(' ')).join('|')}`

/** A human-readable line per violation, with the selector and the numbers. */
export function describeViolations(violations: ScannedViolation[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 6)
        .map((node) => {
          const reason =
            String(node.failureSummary ?? '')
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .pop() ?? ''
          return `${node.target.join(' ')}\n          ${reason}`
        })
        .join('\n        ')
      const more =
        violation.nodes.length > 6 ? `\n        …and ${violation.nodes.length - 6} more` : ''
      return `[${violation.impact ?? 'n/a'}] ${violation.id}: ${violation.help} — ${violation.nodes.length} node(s), scroll stop ${violation.scrollAt}\n        ${nodes}${more}`
    })
    .join('\n  ')
}
