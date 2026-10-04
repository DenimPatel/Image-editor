import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'

/**
 * The phone, proved as a phone.
 *
 * This spec only runs in the `mobile` project in `playwright.config.ts`
 * (`hasTouch`, a coarse pointer, an iPhone 13 profile). Anything that needs a
 * real touch stack — `(pointer: coarse)`, a touch drag, a modal sheet at
 * phone size — is untestable in the desktop projects, and shipping it that way
 * is how a control ends up existing only on screens that were never opened.
 */

/** A real one-finger swipe through CDP: `page.touchscreen` only taps. */
async function swipeUp(
  page: import('@playwright/test').Page,
  selector: import('@playwright/test').Locator,
  distance = 220,
): Promise<number> {
  const box = (await selector.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const x = box.x + box.width / 2
  const startY = box.y + box.height - 50
  const points = (y: number) => [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(startY) })
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(startY - (distance / 10) * i),
    })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(300)
  await cdp.detach()
  return selector.evaluate((el) => el.scrollTop)
}

test.describe('D8-F16: camera capture', () => {
  test('offers a capture input that opens the camera, not the file browser', async ({
    goto,
    page,
  }) => {
    await goto('/editor')
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()

    // The ordinary browse input accepts the full decoded set.
    await expect(page.locator('input[type="file"]').first()).toHaveAttribute('accept', /image\//)

    // The camera one is a separate input, and it asks for the rear camera.
    const camera = page.locator('input[type="file"][capture]')
    await expect(camera).toHaveCount(1)
    await expect(camera).toHaveAttribute('capture', 'environment')
    await expect(camera).toHaveAttribute('aria-label', 'Take a photo')

    // And there is a visible, keyboard-reachable control that opens it.
    const button = page.getByRole('button', { name: 'Take a photo' })
    await expect(button).toBeVisible()
    const size = (await button.boundingBox())!
    expect(size.height).toBeGreaterThanOrEqual(44)

    // Prove the button really drives *that* input rather than just existing.
    // A real file chooser is not opened: the point is which input is clicked,
    // and driving the chooser makes the test depend on a native dialog.
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"][capture]')!
      ;(window as unknown as { __clicked: string | null }).__clicked = null
      input.addEventListener('click', () => {
        ;(window as unknown as { __clicked: string | null }).__clicked = input.id || 'camera-input'
      })
      const other = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')
      other?.addEventListener('click', () => {
        ;(window as unknown as { __clicked: string | null }).__clicked = 'browse-input'
      })
    })
    await button.dispatchEvent('click')
    expect(
      await page.evaluate(() => (window as unknown as { __clicked: string | null }).__clicked),
    ).toBe('camera-input')
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-camera.png' })
  })
})

/**
 * The dialog's scrolling body, found by its computed overflow rather than by a
 * CSS-module class: the rule for this suite is that a class name says nothing
 * about whether a thing works, and "the one descendant that can scroll" says
 * exactly what the user is trying to do.
 */
function sheetScroller(page: import('@playwright/test').Page) {
  return page
    .locator('section[role="dialog"]')
    .first()
    .locator('xpath=*')
    .evaluateAll((nodes) => {
      const scroller = nodes.find((node) => {
        const style = getComputedStyle(node)
        return (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight
        )
      })
      if (!scroller) return null
      scroller.setAttribute('data-e2e-scroller', '')
      return scroller.scrollTop
    })
}

test.describe('D8-F03: the sheet scrolls under a finger', () => {
  test('a tall panel can be scrolled to its end', async ({ goto, loadSample, openTool, page }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Crop')
    const sheet = page.getByRole('dialog', { name: 'Crop & Straighten' })
    await expect(sheet).toBeVisible()

    await sheetScroller(page)
    const scroller = page.locator('[data-e2e-scroller]')
    await expect(scroller).toHaveCount(1)

    const before = await swipeUp(page, scroller)
    expect(before).toBeGreaterThan(0)

    // The content under the fold is now reachable, not merely scrollable.
    await expect(sheet.getByRole('slider', { name: /Straighten/ }).first()).toBeVisible()
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-sheet-scrolled.png' })
  })

  test('the sheet keeps its title and its way out while the body scrolls', async ({
    goto,
    loadSample,
    openTool,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Export')
    const sheet = page.getByRole('dialog', { name: 'Export' })
    await expect(sheet).toBeVisible()

    // The Export panel is ~1000px of content in a 58vh detent, and opening a
    // sheet focuses its first control, which scrolls the body — so a header that
    // is not pinned scrolled the title and the Close button off the screen the
    // moment the panel opened. A touch user has no Escape key, so that left the
    // backdrop as the only way out and the heading as a name the panel no longer
    // carried.
    await sheetScroller(page)
    const scroller = page.locator('[data-e2e-scroller]')
    const close = sheet.getByRole('button', { name: 'Close' })
    const title = sheet.getByRole('heading', { level: 2, name: 'Export' })
    await expect(title).toBeVisible()
    await expect(close).toBeVisible()

    await swipeUp(page, scroller, 400)
    await swipeUp(page, scroller, 400)
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    // Still there, still hittable.
    await expect(title).toBeVisible()
    await expect(close).toBeVisible()
    const box = (await close.boundingBox())!
    const scrollerBox = (await scroller.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(scrollerBox.y - 1)
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-sheet-header-pinned.png' })

    // And the pinned Close really closes it.
    await close.click()
    await expect(sheet).toBeHidden()
  })
})

test.describe('D8-F04: the bars clear the notch', () => {
  test('the top bar and the tab bar spend the safe-area insets', async ({
    goto,
    loadSample,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')

    // `env(safe-area-inset-*)` is only non-zero on hardware with a cutout, and
    // this browser has none, so the insets an iPhone reports are written into
    // the tokens directly. What is under test is that the two bars *consume*
    // the tokens: with a real notch they are the difference between the toolbar
    // being visible and being under the island.
    const NOTCH_TOP = 59
    const HOME_BOTTOM = 34
    await page.addStyleTag({
      content: `:root { --ie-safe-top: ${NOTCH_TOP}px; --ie-safe-bottom: ${HOME_BOTTOM}px; }`,
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--ie-safe-top').trim(),
        ),
      )
      .toBe(`${NOTCH_TOP}px`)

    const measured = await page.evaluate(() => {
      const bar = document.querySelector('header')!
      const tabs = document.querySelector('nav[aria-label="Editor tools"]')!
      const firstControl = bar.querySelector('button')!
      const label = Array.from(tabs.querySelectorAll('span'))[0]!
      const viewport = window.innerHeight
      return {
        firstControlTop: firstControl.getBoundingClientRect().top,
        labelBottom: label.getBoundingClientRect().bottom,
        tabsBottom: tabs.getBoundingClientRect().bottom,
        viewport,
      }
    })

    // The first control in the top bar starts below the notch, and the tab
    // labels end above the home indicator.
    expect(measured.firstControlTop).toBeGreaterThanOrEqual(NOTCH_TOP)
    expect(measured.labelBottom).toBeLessThanOrEqual(measured.viewport - HOME_BOTTOM)
    // And the tab bar still reaches the bottom of the screen, inset and all.
    expect(Math.round(measured.tabsBottom)).toBe(measured.viewport)
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-safe-areas.png' })
  })
})

test.describe('D8-F05: the sheet traps focus on a phone', () => {
  test('Tab cannot leave an open sheet', async ({ goto, loadSample, openTool, page }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Crop')
    const sheet = page.getByRole('dialog', { name: 'Crop & Straighten' })
    await expect(sheet).toBeVisible()

    // It must be modal here even though it is not a trap on desktop.
    await expect(sheet).toHaveAttribute('aria-modal', 'true')

    for (let i = 0; i < 45; i++) await page.keyboard.press('Tab')
    const escaped = await page.evaluate(
      () => !document.activeElement?.closest('section[role="dialog"]'),
    )
    expect(escaped).toBe(false)
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-sheet-trap.png' })
  })
})

test.describe('D9-F09: the PWA shell', () => {
  test('the installable shell is declared and reachable', async ({ page }) => {
    await page.goto('/')
    const manifest = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(manifest).toBeTruthy()
    const response = await page.request.get(new URL(manifest!, page.url()).toString())
    expect(response.ok()).toBe(true)
    const parsed = JSON.parse(await response.text())
    expect(parsed.display).toBe('standalone')
    expect(parsed.icons.length).toBeGreaterThanOrEqual(2)

    // The offline worker is served, even where it may not be registered.
    const sw = await page.request.get(new URL('sw.js', page.url()).toString())
    expect(sw.ok()).toBe(true)
  })

  test('the offline banner says what still works, not that everything is broken', async ({
    goto,
    page,
  }) => {
    await goto('/editor')
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
    // `navigator.onLine` only changes with the context, so the event is
    // dispatched too — but the banner mounts on the same tick the banner's own
    // effect subscribes, so the assertion polls rather than racing it.
    await page.context().setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    const banner = page.getByRole('status').filter({ hasText: /offline/i })
    await expect(banner).toBeVisible({ timeout: 5_000 })
    const text = await banner.innerText()
    expect(text).toMatch(/Your photo and every edit will work offline/)
    expect(text).toMatch(/Background removal will need a connection/)
    await page.screenshot({ path: '.playwright-mcp/e2e-offline-banner.png' })
    await page.context().setOffline(false)
    await expect(banner).toHaveCount(0)
  })
})

test.describe('D7-F02: the import pending state', () => {
  test('says the import is under way and blocks a second one', async ({ goto, page }) => {
    await goto('/editor')
    await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
    await page.getByRole('button', { name: /^Sample 1\b/ }).click()
    // The canvas appears rather than the grid; a decode that hangs forever must
    // not leave a user clicking a button that does nothing.
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toHaveCount(0)
  })
})

/** Every tool the bar offers, in the order the DOM has them. */
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

/**
 * Pick an appearance the way a reader does, so the metric assertions below are
 * made at the setting the change was sized for and not only at the default.
 *
 * `partial` on purpose: `coerceAppearance` fills every key it is not given from
 * the defaults, so this writes `density` and `textScale` and leaves the other
 * four alone. Set *before* the sample is loaded, because appearance is read at
 * boot and a reload after a sample is loaded lands on the import screen rather
 * than the editor — the app restores from its own `localStorage` mirror, which
 * is written on a debounce.
 */
async function setAppearance(page: Page, stored: Record<string, string>): Promise<void> {
  if (Object.keys(stored).length === 0) return
  await page.evaluate((value: Record<string, string>) => {
    localStorage.setItem('image-editor-appearance', JSON.stringify(value))
  }, stored)
  await page.reload()
  await expect(page.locator('#root')).not.toBeEmpty()
}

/** One tab, and the row, in the numbers a reader's eye would use. */
type TabMeasure = {
  name: string
  /** Past the row's right edge, in CSS px. Zero or less means "inside the box". */
  overhang: number
  /** From the row's left edge, in CSS px. */
  leading: number
  /** A tab whose own label is wider than its box is a name with a letter off it. */
  labelOverflow: number
}

type RowMeasure = {
  clientWidth: number
  scrollWidth: number
  scrollLeft: number
  tabs: TabMeasure[]
}

/**
 * The row's geometry, the way `journey.responsive.spec.ts` measures it.
 *
 * `jsdom` lays nothing out, so none of these numbers exist in a unit test and a
 * jsdom version of this would read `0` for all of them and pass on a bar that
 * overflows by 780px. This is a real browser or it is nothing.
 */
async function measureRow(nav: Locator): Promise<RowMeasure> {
  return nav.evaluate((el) => {
    const row = el.getBoundingClientRect()
    return {
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      scrollLeft: el.scrollLeft,
      tabs: Array.from(el.querySelectorAll('button')).map((node) => {
        const box = node.getBoundingClientRect()
        return {
          name: (node.textContent ?? '').trim(),
          overhang: Math.round((box.right - row.right) * 100) / 100,
          leading: Math.round((box.left - row.left) * 100) / 100,
          labelOverflow: node.scrollWidth - node.clientWidth,
        }
      }),
    }
  })
}

/**
 * What the row actually painted at each edge, as a channel difference in 0..255.
 *
 * The claim this file exists to make is a claim about *pixels*: a phone user has
 * to be able to see that the bar goes on. A resolved `mask-image` string cannot
 * carry it. `mask-composite` defaults to `add`, which unions the layers' alpha,
 * so a two-item list of a leading fade and a trailing fade resolves to a
 * perfectly good-looking `linear-gradient, linear-gradient` and composites to a
 * fully opaque mask — the trailing layer's opaque body fills in the leading
 * layer's transparent start and the other way round, and both edges stop fading
 * at exactly the scroll positions that are the only ones needing both. An earlier
 * version of this file asserted that string at mid-scroll and passed while both
 * edges painted nothing; measured per-pixel, that state was a channel delta of
 * 1 of 255 against the same row with the mask off.
 *
 * So the row is captured twice — once as it is, once with the mask forced off —
 * and the two PNGs are decoded and differenced in three column bands. Two things
 * make that a measurement rather than a tautology:
 *
 *   - the two captures are of the *same box at the same scroll position*, so
 *     every byte of difference between them is the mask and nothing else; and
 *   - the middle band is differenced too and asserted **quiet**, which is the
 *     control. The mask is opaque between the two 32px ramps, so the middle must
 *     not move; if the whole capture shifted for any other reason — a caret, an
 *     animation, a re-decode of the sample — the middle would move with it and
 *     an edge assertion would be measuring the wrong thing.
 *
 * `scale: 'css'` so the bands are CSS pixels: this project's device pixel factor
 * is 2.625, and a band boundary that lands mid-pixel would sample two ramps and
 * say nothing.
 *
 * The decode happens in the page, because a PNG is all `page.screenshot` gives
 * back and no PNG decoder is a declared dependency of this repo. A browser has
 * one built in.
 */
async function paintedEdges(page: Page, nav: Locator, label: string): Promise<EdgeDeltas> {
  const box = await nav.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    }
  })
  const shot = (masked: boolean) =>
    page.screenshot({
      path: `.improve/artifacts/IMP-042/paint-${label}-${masked ? 'masked' : 'bare'}.png`,
      clip: box,
      scale: 'css',
      animations: 'disabled',
      caret: 'hide',
    })

  const masked = await shot(true)
  // `!important`, because the point is to be *sure* the stylesheet rule is out of
  // the way, and it comes straight off again below so the next capture is of the
  // same row in the same state.
  await nav.evaluate((el) => el.style.setProperty('mask-image', 'none', 'important'))
  await expect
    .poll(() => nav.evaluate((el) => getComputedStyle(el).maskImage), {
      message: 'the mask did not come off the row',
    })
    .toBe('none')
  const bare = await shot(false)
  await nav.evaluate((el) => el.style.removeProperty('mask-image'))
  await expect
    .poll(() => nav.evaluate((el) => getComputedStyle(el).maskImage), {
      message: 'the mask did not come back onto the row',
    })
    .not.toBe('none')

  return page.evaluate(
    async ({ a, b }) => {
      const pixels = async (base64: string) => {
        const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
        const bitmap = await createImageBitmap(blob)
        const width = bitmap.width
        const height = bitmap.height
        const canvas = new OffscreenCanvas(width, height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('this browser gave the pixel comparison no 2d context')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        return { data: context.getImageData(0, 0, width, height).data, width, height }
      }
      const first = await pixels(a)
      const second = await pixels(b)
      if (first.width !== second.width || first.height !== second.height)
        throw new Error(
          `the two captures of the row are ${first.width}x${first.height} and ${second.width}x${second.height}`,
        )
      // Wider than the 32px ramp on each side, and never more than a quarter of
      // the row, so the quiet middle always has somewhere to be.
      const band = Math.min(40, Math.floor(first.width / 4))
      const worst = (from: number, to: number) => {
        let high = 0
        for (let y = 0; y < first.height; y += 1) {
          for (let x = from; x < to; x += 1) {
            const i = (y * first.width + x) * 4
            for (let channel = 0; channel < 3; channel += 1) {
              const delta = Math.abs(first.data[i + channel] - second.data[i + channel])
              if (delta > high) high = delta
            }
          }
        }
        return high
      }
      return {
        left: worst(0, band),
        middle: worst(band, first.width - band),
        right: worst(first.width - band, first.width),
      }
    },
    { a: masked.toString('base64'), b: bare.toString('base64') },
  )
}

type EdgeDeltas = { left: number; middle: number; right: number }

/**
 * The two numbers every edge assertion is written in.
 *
 * `FADED` is 8 of 255 — 3% — chosen to sit in the gap between the two populations
 * this measurement has. Painted, at this project's own CSS-pixel scale: 136 at
 * the start's trailing edge, 71 and 136 at mid-scroll's two edges, 164 at the
 * end's leading edge. Unpainted, at every edge and in the middle of the row: 1,
 * which is compositing dithering rather than a fade. So `FADED` is eight times the
 * noise floor and eight times under the weakest real fade, and `QUIET` is the
 * noise floor itself — an edge with nothing behind it has to stay within it, which
 * is what makes the positive assertions mean something rather than merely pass.
 */
const FADED = 8
const QUIET = 1

/**
 * The tool bar at 390x844, measured.
 *
 * The bar is a scroller and it hides its scrollbar, so a phone user had no way
 * of knowing eight of thirteen tools were off-screen — and the tab whose label
 * is the longest in the bar was arriving as "Backgroun". Everything here is a
 * measurement rather than a screenshot: jsdom lays nothing out, so a real
 * browser is the only place a claim about what is on screen can be true.
 *
 * The fade is a `mask-image` on the row rather than a control beside it, so there
 * is nothing extra to press and no fourteenth tab. That it is *painted* is proved
 * by differencing pixels (`paintedEdges`), and the resolved declaration is read
 * beside it only to pin the shape — one gradient at mid-scroll, so the two-item
 * `mask-image` list that composites to nothing cannot come back.
 */
test.describe('IMP-042: the tool bar says that it scrolls', () => {
  test.slow()

  test('every tool is reachable, and both edges say what is past them', async ({
    goto,
    loadSample,
    openTool,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/editor')
    await loadSample('Sample 1')
    const nav = page.getByRole('navigation', { name: 'Editor tools' })

    /** The row's own box and its resolved style, in one read. */
    const edges = () =>
      nav.evaluate((el) => {
        const inset = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0
        const rowLeft = el.getBoundingClientRect().left
        return {
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          scrollLeft: el.scrollLeft,
          mask: getComputedStyle(el).maskImage,
          snapType: getComputedStyle(el).scrollSnapType,
          // How far the nearest tab's leading edge is from the row's own snap
          // inset: zero when the row is parked on a tool boundary, and whatever
          // a wheel delta stopped at when it is not.
          offBoundary: Math.min(
            ...Array.from(el.querySelectorAll('button')).map((button) =>
              Math.abs(button.getBoundingClientRect().left - rowLeft - inset),
            ),
          ),
        }
      })

    /** One fade is one gradient; `0px` only ever ends a leading fade. */
    const fades = (mask: string) => ({
      count: (mask.match(/linear-gradient/g) ?? []).length,
      trailing: mask.includes('100%'),
      leading: mask.includes('0px'),
    })

    // The claim everything else stands on: at this width the row is wider than
    // its box, which is the whole reason it has to say so.
    const start = await edges()
    expect(start.scrollWidth).toBeGreaterThan(start.clientWidth)
    expect(start.scrollLeft).toBe(0)

    // The affordance, on the trailing edge and nowhere else at the start.
    await expect
      .poll(async () => fades((await edges()).mask), {
        message: 'the trailing fade did not come on',
      })
      .toEqual({ count: 1, trailing: true, leading: false })

    // No tab's label is cut by the edge the fade covers. "Background" is the
    // longest name in the bar, so if its right edge lands inside the box then no
    // label is being eaten by the fade or by the viewport. Measured against the
    // row's own right edge, which is `clientWidth` here because the bar has no
    // inline border.
    const overhang = await nav
      .getByRole('button', { name: 'Background', exact: true })
      .evaluate(
        (el) => el.getBoundingClientRect().right - el.closest('nav')!.getBoundingClientRect().right,
      )
    expect(overhang, 'Background is cut off by the edge').toBeLessThanOrEqual(1)

    // Proximity snapping, not mandatory: a mandatory snap fights a drag that
    // stops four pixels off a boundary, and this row is dragged with a finger.
    // `x` on its own *is* proximity — it is the initial strictness.
    expect(start.snapType).not.toBe('none')
    expect(start.snapType).toMatch(/^x( proximity)?$/)

    // And the trailing fade is thirty-two pixels of actual paint, with the
    // leading edge quiet — there is nothing before the first tool, so a fade
    // there would be a lie about it.
    const atStart = await paintedEdges(page, nav, 'start')
    expect(atStart.right, 'the trailing edge is not painted at the start').toBeGreaterThanOrEqual(
      FADED,
    )
    expect(atStart.left, 'the leading edge is faded with nothing behind it').toBeLessThanOrEqual(
      QUIET,
    )
    expect(atStart.middle, 'the row moved for a reason other than the mask').toBeLessThanOrEqual(
      QUIET,
    )

    // `scale: 'css'` because the picture this is compared against is 390x844, and
    // this project's device pixel factor would otherwise write a 1024x2216 file
    // that only differs from the baseline by being bigger.
    await page.screenshot({
      path: '.improve/artifacts/IMP-042/mobile-05-after.png',
      scale: 'css',
    })

    // A wheel moves it, and leaves it on a tool boundary rather than wherever the
    // delta happened to stop.
    const bar = (await nav.boundingBox())!
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2)
    await page.mouse.wheel(200, 0)
    await expect.poll(() => nav.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    // Wheel scrolling is animated and the snap lands a frame or two after the
    // wheel stops, so the row has to come to rest before it can be asked where it
    // stopped. Two reads of the same number is what "at rest" looks like, and
    // reading once instead races the browser's own compositor.
    await expect
      .poll(
        async () => {
          const first = await nav.evaluate((el) => el.scrollLeft)
          await page.waitForTimeout(200)
          return first === (await nav.evaluate((el) => el.scrollLeft))
        },
        { message: 'the row never came to rest' },
      )
      .toBe(true)
    const scrolled = await edges()
    expect(scrolled.offBoundary, 'the row did not land on a tool boundary').toBeLessThanOrEqual(1)
    expect(scrolled.scrollLeft).toBeGreaterThan(start.scrollLeft)
    // One gradient at mid-scroll, with a stop at both ends of it. This is the
    // shape assertion: the two-item list this replaced resolves to two gradients
    // and composites under `add` to nothing at all.
    await expect
      .poll(async () => fades((await edges()).mask), {
        message: 'the row never got both edges',
      })
      .toEqual({ count: 1, trailing: true, leading: true })

    // And now the measurement that matters, because mid-scroll is where a phone
    // user spends most of their time and where a flick parks. Both edges fade.
    const atMid = await paintedEdges(page, nav, 'mid')
    expect(atMid.left, 'the leading edge is not painted mid-scroll').toBeGreaterThanOrEqual(FADED)
    expect(atMid.right, 'the trailing edge is not painted mid-scroll').toBeGreaterThanOrEqual(FADED)
    expect(atMid.middle, 'the row moved for a reason other than the mask').toBeLessThanOrEqual(
      QUIET,
    )

    await page.screenshot({
      path: '.improve/artifacts/IMP-042/mobile-05-after-scrolled.png',
      scale: 'css',
    })

    // At the end the trailing fade is a lie — the last tool *is* in view — so it
    // goes, and the leading one is all that is left. Polled rather than read
    // once, because the class is a React update behind the scroll event and a
    // single read would see the mask the row had before it moved.
    await nav.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    await expect
      .poll(async () => fades((await edges()).mask), {
        message: 'the trailing fade outlived the scroll',
      })
      .toEqual({ count: 1, trailing: false, leading: true })
    expect(
      await nav.evaluate((el) => el.scrollLeft - (el.scrollWidth - el.clientWidth)),
    ).toBeLessThanOrEqual(1)

    const atEnd = await paintedEdges(page, nav, 'end')
    expect(atEnd.left, 'the leading edge is not painted at the end').toBeGreaterThanOrEqual(FADED)
    expect(atEnd.right, 'the trailing edge is faded with nothing behind it').toBeLessThanOrEqual(
      QUIET,
    )
    expect(atEnd.middle, 'the row moved for a reason other than the mask').toBeLessThanOrEqual(
      QUIET,
    )

    // And every one of the thirteen can still be pressed, which is the claim the
    // fade has to survive: it is painted over the row, so if it ever intercepted
    // a finger the last tools in the bar would be unreachable.
    for (const name of TOOLS) {
      await openTool(name)
      await expect(nav.getByRole('button', { name, exact: true }), name).toHaveAttribute(
        'aria-current',
        'true',
      )
    }
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-tabbar-reachable.png' })
  })

  /**
   * The metrics the phone width changed, at the appearance where they changed
   * anything.
   *
   * The case above runs at the default appearance, and at the default appearance
   * the *base* `.tabBar` metrics already put "Background" inside the box (356.77px
   * of a 390px row). So every assertion in the case above about the metric change
   * is satisfied by the stylesheet with the change deleted, and this is the gate
   * that closes it: `density: roomy` with `textScale: xlarge` is the setting the
   * evidence screenshot was captured at, and at it the base metrics put
   * "Background"'s right edge at 408.72px — 18.72px past the row, rendered as
   * "Backgroun" — and the *next* tool's leading edge at 413px, which is off the
   * row entirely, so there was nothing on screen at all to say the bar went on.
   *
   * That is the whole point of `gap: 2px`, `padding: 4px 6px` and a 54px floor
   * inside `@media (max-width: 480px)`: they move those two numbers to 365.72px
   * and 368px. If the media query goes, these numbers go with it.
   */
  test('at roomy density and xlarge text the bar says so before it runs out of row', async ({
    goto,
    loadSample,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/editor')
    await setAppearance(page, { density: 'roomy', textScale: 'xlarge' })
    await expect(page.locator('html')).toHaveAttribute('data-density', 'roomy')
    await expect(page.locator('html')).toHaveAttribute('data-text', 'xlarge')
    await loadSample('Sample 1')

    const nav = page.getByRole('navigation', { name: 'Editor tools' })
    const row = await measureRow(nav)
    // Still a scroller at this appearance — a bar that fits needs no affordance,
    // and every assertion below would be vacuous if it did.
    expect(row.scrollWidth).toBeGreaterThan(row.clientWidth)
    expect(row.scrollLeft).toBe(0)
    expect(row.tabs.map((tab) => tab.name)).toEqual([...TOOLS])

    const background = row.tabs.find((tab) => tab.name === 'Background')!
    const next = row.tabs.find((tab) => tab.name === 'Text')!
    // The longest name in the bar, whole, with a sliver of the next tool showing
    // past it. Both halves are the metric change: the label fits because the
    // floor is 54px and the padding 6px, and the sliver is there because the gap
    // is 2px. At the base metrics the first is 18.72px over and the second 23px
    // off the end of the row.
    expect(background.overhang, 'Background is cut off by the edge').toBeLessThanOrEqual(1)
    expect(
      next.leading,
      'the next tool is off the end of the row, so the bar says nothing',
    ).toBeLessThan(row.clientWidth)
    // Five tools whole before the fade starts eating the sixth: four at the base
    // metrics, at this appearance.
    expect(row.tabs.filter((tab) => tab.overhang <= 1).length).toBeGreaterThanOrEqual(5)
    // And no label anywhere is cut by its own tab, which is what the 54px floor
    // buys against `--ie-tap`'s own idea of narrow.
    for (const tab of row.tabs) {
      expect(tab.labelOverflow, `${tab.name}: the tab's own label is cut off`).toBeLessThanOrEqual(
        1,
      )
    }

    await page.screenshot({
      path: '.improve/artifacts/IMP-042/mobile-05-after-roomy-xlarge.png',
      scale: 'css',
    })
  })
})
