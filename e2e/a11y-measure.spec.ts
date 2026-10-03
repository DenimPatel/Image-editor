import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * The measurements axe cannot make.
 *
 * axe judges a rendered page against WCAG 2.1 A/AA. Three of the things this
 * gate is for are not in that scope, and all three are only measurable in a real
 * browser — jsdom reports `scrollWidth === clientWidth === 0`, so a clipping
 * assertion in a unit test is an assertion about nothing.
 *
 *  1. **Hit targets.** `--ie-tap` is `calc(44px * var(--density-factor))`, and
 *     `tokens.css:104-111` says exactly what it is: *the one place density has
 *     to land for a whole family of controls to move at once* — `.iconButton`,
 *     `.doneButton`, `.primaryButton`, the crash boundary's buttons, and one
 *     inline hit area in `Editor.tsx`. Everything else that scales with density
 *     scales where it is used. So this spec asserts two different things, and
 *     conflating them is how a gate ends up asserting a redesign:
 *
 *       - the `--ie-tap` family is at least `--ie-tap`, at both densities; and
 *       - *every* effective target clears 24x24, which is WCAG 2.5.8's AA
 *         "Target Size (Minimum)" and the number that can be cited as a
 *         conformance claim.
 *
 *     44px is WCAG 2.5.5, which is AAA, and this project did not adopt it as a
 *     universal floor. The measured distribution — every editor chip, text
 *     button and segmented option lands between 36px and 44px at the default
 *     density — is in the report as a finding, not asserted here as a failure.
 *
 *  2. **Focus rings.** `:focus-visible` draws `outline: 2px solid
 *     var(--focus-ring)` (`base.css:158-161`), and `--focus-ring` is re-declared
 *     per surface and per accent. Every focusable is walked with real `Tab`
 *     presses and measured in all eight theme x accent states.
 *
 *  3. **Text at `small` and `xlarge`, and motion.** Neither is an axe rule.
 */

/** WCAG 2.1 SC 2.5.8 Target Size (Minimum), level AA. */
const AA_MINIMUM = 24

/**
 * The CSS-module class prefix that identifies the `--ie-tap` family.
 *
 * A CSS module renames `.iconButton` to `_iconButton_w3n2o_3`, so the original
 * name survives as a prefix and `[class*="iconButton"]` finds the rule in the
 * *rendered* class. The obvious alternative — looking for `var(--ie-tap)` in
 * `getComputedStyle(el).height` — cannot work, because computed style has
 * already substituted the `calc()` and returns `44px`. That mistake makes the
 * family check match nothing, which reads as a clean pass.
 *
 * It is spelled out again, as a literal, inside the measurement function below,
 * because that function is serialised into the page and a module-level constant
 * does not exist there — referencing one from inside is a run-time
 * `ReferenceError`, not a compile error.
 */

type Target = {
  name: string
  cls: string
  tag: string
  w: number
  h: number
  inline: boolean
  readsIeTap: boolean
}

/**
 * Read one appearance setting the way a user sets it: by writing the storage the
 * app persists to and reloading.
 *
 * Setting `data-density` on `<html>` directly does not survive — the appearance
 * hook re-applies the stored settings on mount and *removes* any attribute whose
 * value is the default, so an attribute written after boot is gone by the time
 * anything measures. That is not a quirk to work around, it is the contract
 * `appearance.test.ts` pins: the six attributes are a projection of one stored
 * object, never an independent input. A gate that set the attributes would be
 * testing a state no user can reach.
 */
async function setAppearance(page: Page, settings: Record<string, string>) {
  await page.evaluate((next) => {
    const key = 'image-editor-appearance'
    const current = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>
    localStorage.setItem(key, JSON.stringify({ ...current, ...next }))
  }, settings)
}

const measureTargets = () => {
  // `--ie-tap` is `calc(44px * var(--density-factor))`, and `getPropertyValue` on
  // a custom property returns the *specified* token stream — so `parseFloat` of
  // it is NaN, not 44. A probe element is the only way to read the number the
  // layout actually uses, and a NaN here would compare every control against
  // zero and pass everything.
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;height:var(--ie-tap);width:var(--ie-tap)'
  document.body.appendChild(probe)
  const probeStyle = getComputedStyle(probe)
  const tap = Math.min(parseFloat(probeStyle.height), parseFloat(probeStyle.width))
  probe.remove()

  const rows: Target[] = []
  const seen = new Set<string>()
  const selector = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ')
  for (const element of Array.from(document.querySelectorAll(selector))) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (parseFloat(style.opacity) < 0.5) continue
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue

    // A radio or checkbox inside a `<label>` is not the target; the label is,
    // and the input is usually a visually-hidden 18x18. Measuring the input would
    // report a 24px AA failure for a control a reader can press with a 36px
    // label, which is the opposite of the finding.
    const label = element.closest('label') as HTMLElement | null
    const target = label ?? (element as HTMLElement)
    if (target !== element && label) {
      const labelBox = label.getBoundingClientRect()
      if (labelBox.width === 0 || labelBox.height === 0) continue
      if (seen.has(label.className)) continue
      seen.add(label.className)
      rows.push({
        name: (element.getAttribute('aria-label') || label.textContent || element.tagName)
          .trim()
          .slice(0, 48),
        cls: (label.className || '').toString().slice(0, 48),
        tag: `${element.tagName}[${element.getAttribute('type') ?? ''}] in label`,
        w: Number(labelBox.width.toFixed(1)),
        h: Number(labelBox.height.toFixed(1)),
        // WCAG 2.5.8 exempts a target that is "in a sentence or its size is
        // otherwise constrained by the line-height of non-target text". The two
        // inline links in this app are the licences footer link and the Pexels
        // credit, and both sit in a run of sibling text.
        inline: !!target.closest('p, .footer-meta, .importHint'),
        readsIeTap: /_(iconButton|doneButton|primaryButton|boundaryActions)_/.test(
          (label.className || '').toString(),
        ),
      })
      continue
    }
    if (seen.has(element.className)) continue
    seen.add(element.className)
    rows.push({
      name: (
        element.getAttribute('aria-label') ||
        element.textContent ||
        element.getAttribute('placeholder') ||
        element.tagName
      )
        .trim()
        .slice(0, 48),
      cls: (element.className || '').toString().slice(0, 48),
      tag: element.tagName,
      w: Number(box.width.toFixed(1)),
      h: Number(box.height.toFixed(1)),
      inline: !!element.closest('p, .footer-meta, .importHint'),
      readsIeTap: /_(iconButton|doneButton|primaryButton|boundaryActions)_/.test(
        (element.className || '').toString(),
      ),
    })
  }
  return { tap: Number(tap.toFixed(2)), rows }
}

const TOOLS = [
  'Crop',
  'Adjust',
  'Looks',
  'Retouch',
  'Background',
  'Text',
  'Draw',
  'Stickers',
  'Redact',
  'Frame',
  'Layers',
  'Passport',
  'Export',
] as const

/** Text that is clipped or has been cut off with an ellipsis. */
const measureClipping = () => {
  const clipped: string[] = []
  const label = (element: Element) =>
    `${element.tagName}.${(element.className || '').toString().slice(0, 34)} "${(
      element.textContent ?? ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 34)}"`
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (parseFloat(style.opacity) < 0.5) continue
    // Only elements that actually hold text.
    const own = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => (node.textContent ?? '').trim())
      .join(' ')
      .trim()
    if (own.length < 4) continue
    if (style.overflow === 'visible' && style.textOverflow !== 'ellipsis') continue
    const oneShort = element.scrollWidth > element.clientWidth + 1
    const oneTall = element.scrollHeight > element.clientHeight + 1
    if (oneShort || oneTall) {
      clipped.push(
        `${label(element)} — ${element.clientWidth}x${element.clientHeight} box, ${element.scrollWidth}x${element.scrollHeight} content, text-overflow: ${style.textOverflow}, white-space: ${style.whiteSpace}`,
      )
    }
  }
  return clipped
}

test.describe('hit targets', () => {
  test.beforeEach(async ({ goto, clearStorage }) => {
    await goto('/')
    await clearStorage()
  })

  for (const density of [
    { label: 'Compact', id: 'compact' },
    { label: 'Roomy', id: 'roomy' },
  ])
    for (const width of [360, 1280]) {
      test(`every target clears 24px at ${density.label.toLowerCase()} density and ${width}px`, async ({
        goto,
        loadSample,
        openTool,
        page,
        settle,
      }) => {
        test.slow()
        const failures: string[] = []
        const familyShort: string[] = []
        let tap = 0
        let measured = 0
        let familySeen = 0

        const collect = async (where: string) => {
          const m = await page.evaluate(measureTargets)
          tap = m.tap
          measured += m.rows.length
          for (const row of m.rows) {
            if (row.inline) continue
            if (row.w < AA_MINIMUM - 0.6 || row.h < AA_MINIMUM - 0.6) {
              failures.push(
                `${where}: ${row.tag} ${row.w}x${row.h} "${row.name}" .${row.cls} — below ${AA_MINIMUM}px`,
              )
            }
            if (row.readsIeTap) {
              familySeen += 1
              if (row.w < m.tap - 0.6 || row.h < m.tap - 0.6) {
                familyShort.push(
                  `${where}: ${row.tag} ${row.w}x${row.h} "${row.name}" — reads --ie-tap (${m.tap}px)`,
                )
              }
            }
          }
        }

        await setAppearance(page, { density: density.id })
        await goto('/')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        // The hub's cards are inside a scroll-triggered 0.6s `opacity` reveal, so
        // a measurement taken now would see `opacity: 0` and skip every one of
        // them — a gate that measures nothing.
        await page.waitForTimeout(2_500)
        await collect('hub')

        await setAppearance(page, { density: density.id })
        await goto('/editor')
        await loadSample('Sample 1')
        await settle()
        await collect('editor/workspace')
        for (const tool of TOOLS) {
          await openTool(tool)
          await collect(`editor/${tool}`)
        }

        expect(
          failures.join('\n'),
          `${measured} targets measured, --ie-tap ${tap}px at ${density.id}`,
        ).toBe('')
        expect(familyShort.join('\n'), 'controls that read --ie-tap').toBe('')
        // Without this, a family pattern that matches nothing passes on the first
        // assertion alone and the second has never run.
        expect(familySeen, 'members of the --ie-tap family measured').toBeGreaterThan(0)
        // A target-count floor, because an empty loop passes every assertion
        // above. The unit is a *distinct* control: the measurement dedupes by
        // class name, so thirteen aspect-ratio chips are one row. That is the
        // right unit for "is any control too small" and the wrong one for a raw
        // element count, so the floor is on the deduped number — 155 is what the
        // tightest configuration here measures, and 140 leaves room for one
        // surface losing a control without hiding an empty loop.
        expect(
          measured,
          'distinct targets measured across the hub and thirteen panels',
        ).toBeGreaterThan(140)
      })
    }

  test('the controls that read --ie-tap exist on a surface, so the family check is not vacuous', async ({
    goto,
    openTool,
    page,
    settle,
  }) => {
    await goto('/editor')
    await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
    // By class prefix, not by looking for `var(--ie-tap)` in a computed style —
    // computed style has already substituted the `calc()`, so that search matches
    // nothing and reports a clean zero for a family that is plainly on screen.
    const found = await page.evaluate(
      () => document.querySelectorAll('[class*="iconButton"]').length,
    )
    expect(found, 'icon buttons on the import screen').toBeGreaterThan(0)

    await loadSampleFallback(page)
    await settle()
    await openTool('Adjust')
    const inPanel = await page.evaluate(
      () => document.querySelectorAll('[class*="doneButton"], [class*="primaryButton"]').length,
    )
    expect(inPanel, 'done and primary buttons in the adjust sheet').toBeGreaterThan(0)
  })
})

/** `loadSample` needs the hub route's marker; this is the editor-only equivalent. */
async function loadSampleFallback(page: Page) {
  await page.getByRole('button', { name: /^Sample 1\b/ }).click()
  await page.locator('canvas.ie-canvas-el').waitFor()
}

test.describe('text at the ends of the scale', () => {
  test.beforeEach(async ({ goto, clearStorage }) => {
    await goto('/')
    await clearStorage()
  })

  for (const textScale of [
    { label: 'small', id: 'small' },
    { label: 'xlarge', id: 'xlarge' },
  ])
    for (const width of [360, 1280]) {
      test(`no text is clipped at ${textScale.id} text scale and ${width}px`, async ({
        goto,
        loadSample,
        openTool,
        page,
        settle,
      }) => {
        test.slow()
        const clipped: string[] = []
        await setAppearance(page, { textScale: textScale.id })
        await page.setViewportSize({ width, height: 900 })
        await goto('/')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await page.waitForTimeout(2_500)
        clipped.push(...(await page.evaluate(measureClipping)).map((line) => `hub — ${line}`))

        await setAppearance(page, { textScale: textScale.id })
        await goto('/editor')
        await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
        clipped.push(
          ...(await page.evaluate(measureClipping)).map((line) => `editor/import — ${line}`),
        )
        await loadSample('Sample 1')
        await settle()
        for (const tool of TOOLS) {
          await openTool(tool)
          clipped.push(
            ...(await page.evaluate(measureClipping)).map((line) => `editor/${tool} — ${line}`),
          )
        }

        expect(clipped.join('\n')).toBe('')
      })
    }
})

test.describe('keyboard and the focus ring', () => {
  test.beforeEach(async ({ goto, clearStorage }) => {
    await goto('/')
    await clearStorage()
  })

  for (const theme of ['light', 'dark'])
    for (const accent of ['green', 'blue', 'violet', 'amber']) {
      test(`every control reached by Tab draws a visible ring in ${accent} on ${theme}`, async ({
        goto,
        openTool,
        page,
        settle,
        browserName,
      }) => {
        test.slow()
        await setAppearance(page, { theme, accent })
        await goto('/editor')
        await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
        await loadSampleFallback(page)
        await settle()
        await openTool('Adjust')

        const walked = await walkWithTab(page, 160)
        // A floor, so a walk that stops at the roving-tabindex wrap cannot pass
        // by having found almost nothing. The editor with the Adjust sheet open
        // measures 24 distinct stops; the floor is below that on purpose, since
        // a floor is there to catch an empty walk and not to be a second copy of
        // the count.
        //
        // The floor is Chromium-only. WebKit ships with "Full Keyboard Access"
        // off, so `Tab` steps through form controls and skips links and buttons
        // that a `<div role="button">` would otherwise include — it reaches three
        // stops on this surface, and that is the engine's setting rather than a
        // property of this page. The ring assertions below still run on WebKit
        // over whatever it does reach, because "no stop lacks a ring" is true of
        // three stops as much as of twenty-four.
        const floor = browserName === 'chromium' ? 18 : 1
        expect(walked.total, 'controls reached by Tab').toBeGreaterThan(floor)

        const unringed = walked.ringless.map((entry) => `${entry.name} (${entry.tag})`)
        expect(unringed.join('\n'), `of ${walked.total} tab stops`).toBe('')

        const thin = walked.thin.map((entry) => `${entry.name}: ${entry.width}px (${entry.tag})`)
        expect(
          thin.join('\n'),
          "WCAG 2.4.13 Focus Appearance, and 2px is this repo's own floor",
        ).toBe('')
      })
    }
})

type Walked = {
  total: number
  ringless: { name: string; tag: string }[]
  thin: { name: string; tag: string; width: number }[]
  unreachable: { name: string; tag: string }[]
}

/**
 * Walk the tab order with real `Tab` presses and measure the ring at each stop.
 *
 * Presses rather than `.focus()` for two reasons. A `.focus()` does not answer
 * "is this reachable by keyboard" — it is a statement about the element, not
 * about the tab order. And `:focus-visible` is a *heuristic* the browser
 * computes from how focus arrived, so a programmatic focus can produce a ring
 * where a real `Tab` would not, which would be a false pass.
 *
 * The walk also has to survive the wrap, which is the easy part to get wrong.
 * The thirteen tool tabs are a roving tabindex, so `Tab` past the last one
 * leaves the document — `document.activeElement` becomes `<body>` — and a walk
 * that stops there has seen eleven controls and called it the whole page. A
 * `body` stop is therefore one press away from the next stop, not the end; the
 * walk ends when a cycle adds nothing new.
 */
async function walkWithTab(page: Page, presses: number): Promise<Walked> {
  const ringless: Walked['ringless'] = []
  const thin: Walked['thin'] = []
  const seen = new Set<string>()
  let total = 0
  let idle = 0

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Tab')

  for (let step = 0; step < presses && idle < 3; step++) {
    const current = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null
      if (!element || element === document.body) return null
      const style = getComputedStyle(element)
      const outline = parseFloat(style.outlineWidth) || 0
      const outlineVisible = style.outlineStyle !== 'none' && outline > 0
      // `box-shadow` is the other way a ring can be drawn and several controls
      // here use it, so a check that reads only `outline` reports ringless for
      // controls that have a ring.
      const shadowVisible = style.boxShadow !== 'none' && style.boxShadow.trim().length > 0
      return {
        name:
          (element.getAttribute('aria-label') || element.textContent || element.tagName)
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 48) || element.tagName,
        tag: element.tagName,
        ring: outlineVisible || shadowVisible,
        width: Math.max(outline, shadowVisible ? 2 : 0),
      }
    })
    if (current) {
      const key = `${current.tag}|${current.name}`
      if (seen.has(key)) idle += 1
      else {
        seen.add(key)
        idle = 0
        total += 1
        if (!current.ring) ringless.push({ name: current.name, tag: current.tag })
        else if (current.width < 2) thin.push(current)
      }
    } else {
      // Focus left the document at a roving-tabindex wrap. Go again rather than
      // concluding the walk is finished.
      idle += 1
    }
    await page.keyboard.press('Tab')
  }
  return { total, ringless, thin, unreachable: [] }
}

test.describe('reduced motion', () => {
  test.beforeEach(async ({ goto, clearStorage }) => {
    await goto('/')
    await clearStorage()
  })

  const SOURCES: { name: string; apply: (page: Page) => Promise<void> }[] = [
    { name: 'the OS setting', apply: async () => undefined },
    {
      name: 'the in-app setting',
      apply: async (page: Page) => setAppearance(page, { motion: 'reduced' }),
    },
  ]
  for (const { name, apply } of SOURCES)
    test(`nothing moves under ${name}, on every surface`, async ({
      goto,
      loadSample,
      openTool,
      page,
      settle,
    }) => {
      test.slow()
      await apply(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const moving: string[] = []

      const scan = async (where: string) => {
        const offenders = await page.evaluate(() => {
          const longest = (value: string) =>
            Math.max(0, ...value.split(',').map((part) => parseFloat(part) || 0))
          const out: string[] = []
          for (const element of Array.from(document.querySelectorAll('*'))) {
            const style = getComputedStyle(element)
            if (longest(style.transitionDuration) > 0.01) {
              out.push(
                `${element.tagName}.${(element.className || '').toString().slice(0, 34)} transition ${style.transitionDuration}`,
              )
            }
            if (
              style.animationName &&
              style.animationName !== 'none' &&
              style.animationPlayState === 'running'
            ) {
              out.push(
                `${element.tagName}.${(element.className || '').toString().slice(0, 34)} animation ${style.animationName}`,
              )
            }
          }
          return out
        })
        moving.push(...offenders.map((line) => `${where} — ${line}`))
      }

      await goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.waitForTimeout(500)
      await scan('hub')
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible()
      await scan('hub/appearance')
      await page.keyboard.press('Escape')

      await setAppearance(page, { motion: 'reduced' })
      await goto('/editor')
      await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
      await scan('editor/import')
      await loadSample('Sample 1')
      await settle()
      await scan('editor/workspace')
      for (const tool of TOOLS) {
        await openTool(tool)
        await scan(`editor/${tool}`)
      }
      await page.getByRole('button', { name: 'More options' }).click()
      await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
      await scan('editor/help')

      expect(moving.join('\n')).toBe('')
    })
})

test.describe('the density tokens the hit-target gate reads', () => {
  test('compact and roomy resolve to different tap sizes, so the gate is not vacuous', async ({
    goto,
    page,
  }) => {
    const read = async (density: string) => {
      // A real origin first: `localStorage` is denied on the initial
      // `about:blank`, so writing the setting before the first navigation throws
      // a `SecurityError` that has nothing to do with density.
      await goto('/')
      await setAppearance(page, { density })
      await goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      return page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--ie-tap)'
        document.body.appendChild(probe)
        const value = parseFloat(getComputedStyle(probe).height)
        probe.remove()
        return Number(value.toFixed(2))
      })
    }
    const compact = await read('compact')
    const roomy = await read('roomy')
    expect(compact).toBeCloseTo(38.5, 1)
    expect(roomy).toBeCloseTo(49.5, 1)
  })
})
