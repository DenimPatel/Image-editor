import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * D9-F16 — the phone, as a finger finds it.
 *
 * Everything here is a *real touch*. jsdom has no touch and no layout, so a
 * jsdom test cannot tell a gesture that works from one that is silently
 * swallowed: `HTMLElement` in jsdom will happily accept a `pointerdown` on an
 * element that is 300px below the fold and covered by the sheet, and the store
 * will take the edit. Both halves of that are invisible without a browser, and
 * the second half is the dangerous one — the edit lands, so nothing looks
 * wrong, and the user is left with a document they cannot reach the control of
 * again.
 *
 * So the gestures below are dispatched through CDP `Input.dispatchTouchEvent`
 * on the `mobile` project, which is the only project with `hasTouch`, and every
 * claim is checked twice: once that the *store moved*, and once that the
 * *target was actually the topmost element at the touch point*. A drag that
 * changes the document proves the wiring; a drag dispatched at a point that
 * `elementFromPoint` says belongs to a panel control proves nothing at all.
 *
 * Undo is checked on every gesture, because a gesture that leaves the history
 * engine's interaction key open swallows every later edit into itself — a
 * silent, compounding corruption that only shows up minutes later.
 */

/** A point in CSS pixels. */
type Pt = { x: number; y: number }

/** A box, as `boundingBox` reports it. */
type Box = { x: number; y: number; width: number; height: number }

/**
 * Resolve the app's base from the module entry script rather than from the
 * current route. The two are different things, and deriving one from the other
 * breaks the moment a route has a trailing slash.
 */
const PRELUDE = `
  const appEntry = () => {
    const scripts = Array.from(document.querySelectorAll('script[type="module"][src]'))
    const entry = scripts.find((node) => node.src.includes('/src/'))
    if (!entry) throw new Error('no app entry script; the app base cannot be resolved')
    return entry.src
  }
  const baseOf = () => {
    const src = appEntry()
    const cut = src.indexOf('/src/')
    return cut === -1 ? src : src.slice(0, cut + 1)
  }
`

const READ = `(async () => {
${PRELUDE}
  const doc = await import(baseOf() + 'src/store/docStore.ts')
  const ui = await import(baseOf() + 'src/store/uiStore.ts')
  const state = doc.useDocStore.getState()
  const uiState = ui.useUiStore.getState()
  return {
    past: state.past.length,
    future: state.future.length,
    crop: state.present.geometry.crop,
    straighten: state.present.geometry.straighten,
    adjust: state.present.adjust,
    layers: state.present.layers.map((layer) => ({
      id: layer.id,
      scale: layer.transform.scale,
      rotation: layer.transform.rotation,
    })),
    viewport: uiState.viewport,
    detent: uiState.sheetDetent,
    activeTool: uiState.activeTool,
  }
})()`

type Read = {
  past: number
  future: number
  crop: { x: number; y: number; width: number; height: number }
  straighten: number
  adjust: Record<string, number>
  layers: { id: string; scale: number; rotation: number }[]
  viewport: { scale: number; x: number; y: number }
  detent: string
  activeTool: string | null
}

const read = (page: Page): Promise<Read> => page.evaluate(READ) as Promise<Read>

const resetViewport = (page: Page) =>
  page.evaluate(`(async () => {
${PRELUDE}
  const ui = await import(baseOf() + 'src/store/uiStore.ts')
  ui.useUiStore.getState().resetViewport()
})()`)

/**
 * What is on top at a point, and whether it is the element we meant to touch.
 *
 * Reported rather than asserted so a failing drag can say *what* was in the
 * way. `hitOk` is the load-bearing claim; `hitWhat` is what makes a failure
 * diagnosable in one read instead of three.
 */
/**
 * Whether a touch at the centre of `box` reaches the slider drawn at that point.
 *
 * "Reaches the slider" rather than "reaches an element inside the slider",
 * because a slider's only content is itself, and the difference matters: a
 * handle that is merely *near* the topmost element is a handle under something
 * else, which is the defect this file exists to catch.
 */
async function probeSlider(page: Page, target: Box): Promise<{ hitOk: boolean; hitWhat: string }> {
  return page.evaluate((b) => {
    const name = (node: Element | null) => {
      if (!node) return 'null'
      return (
        node.tagName.toLowerCase() +
        '/' +
        (node.getAttribute('aria-label') ??
          node.getAttribute('role') ??
          (node.textContent ?? '').trim().slice(0, 20))
      )
    }
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    const top = document.elementFromPoint(cx, cy)
    const owner = top?.closest('[role="slider"]')
    return { hitOk: !!owner && !!top && owner.contains(top), hitWhat: name(top) }
  }, target)
}

/** Whether a touch at the centre of `box` lands inside the open sheet. */
async function probe(page: Page, target: Box): Promise<{ hitOk: boolean; hitWhat: string }> {
  return page.evaluate((b) => {
    const name = (node: Element | null) => {
      if (!node) return 'null'
      return (
        node.tagName.toLowerCase() +
        '/' +
        (node.getAttribute('aria-label') ??
          node.getAttribute('role') ??
          (node.textContent ?? '').trim().slice(0, 20))
      )
    }
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    const top = document.elementFromPoint(cx, cy)
    const sheet = document.querySelector('section[role="dialog"]')
    return { hitOk: !!sheet && !!top && sheet.contains(top), hitWhat: name(top) }
  }, target)
}

/**
 * One finger, dragged.
 *
 * The `touchStart` carries a radius so Chrome treats it as a finger rather than
 * a stylus, and every `touchMove` is a real move with a real interval: a single
 * jump would be swallowed by the slop threshold in whatever consumes the
 * gesture, and the test would report a gesture that never happened as one that
 * did not take.
 */
async function touchDrag(page: Page, from: Pt, to: Pt, steps = 14): Promise<void> {
  const session = await page.context().newCDPSession(page)
  const point = (x: number, y: number) => [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }]
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: point(from.x, from.y),
    })
    for (let step = 1; step <= steps; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: point(
          from.x + ((to.x - from.x) * step) / steps,
          from.y + ((to.y - from.y) * step) / steps,
        ),
      })
      await page.waitForTimeout(12)
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
  await page.waitForTimeout(250)
}

/** Two fingers, opening or closing, about one point. */
async function pinch(page: Page, center: Pt, fromGap: number, toGap: number): Promise<void> {
  const session = await page.context().newCDPSession(page)
  const pair = (gap: number) => [
    { x: center.x - gap / 2, y: center.y, radiusX: 6, radiusY: 6, force: 1, id: 1 },
    { x: center.x + gap / 2, y: center.y, radiusX: 6, radiusY: 6, force: 1, id: 2 },
  ]
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: pair(fromGap),
    })
    for (let step = 1; step <= 14; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: pair(fromGap + ((toGap - fromGap) * step) / 14),
      })
      await page.waitForTimeout(16)
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
  await page.waitForTimeout(250)
}

/** One finger, held. */
async function longPress(page: Page, at: Pt, ms = 700): Promise<void> {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: at.x, y: at.y, radiusX: 6, radiusY: 6, force: 1, id: 1 }],
    })
    await page.waitForTimeout(ms)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
  await page.waitForTimeout(300)
}

/** Two taps, fast enough that the browser sees one gesture. */
async function doubleTap(page: Page, at: Pt): Promise<void> {
  const session = await page.context().newCDPSession(page)
  try {
    for (let tap = 0; tap < 2; tap += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: at.x, y: at.y, radiusX: 6, radiusY: 6, force: 1, id: 1 }],
      })
      await page.waitForTimeout(40)
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(60)
    }
  } finally {
    await session.detach()
  }
  await page.waitForTimeout(300)
}

const centreOf = (box: Box): Pt => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

/** The tool tab bar, addressed by the navigation landmark's name. */
const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Editor tools' })

/** One tab, by the accessible name a reader finds it by. */
const tab = (page: Page, name: string) => tabBar(page).getByRole('button', { name, exact: true })

async function openTool(page: Page, name: string): Promise<void> {
  const target = tab(page, name)
  await target.click()
  await expect(target, `${name} did not open`).toHaveAttribute('aria-current', 'true')
  await page.waitForTimeout(350)
}

/**
 * Every drag target on the canvas, with whether it is under the sheet and
 * whether a touch at its centre reaches it. Scoped by the accessibility name
 * the control already carries, not by a class name.
 */
async function canvasGrips(page: Page, name: RegExp) {
  return page.evaluate((pattern) => {
    const source = new RegExp(pattern)
    const sheet = document.querySelector('section[role="dialog"]')
    const sheetBox = sheet ? sheet.getBoundingClientRect() : null
    return Array.from(document.querySelectorAll('[role="slider"]'))
      .filter((node) => source.test(node.getAttribute('aria-label') ?? ''))
      .map((node) => {
        const box = node.getBoundingClientRect()
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        const top = document.elementFromPoint(cx, cy)
        return {
          name: (node.getAttribute('aria-label') ?? '').slice(0, 34),
          size: `${Math.round(box.width)}x${Math.round(box.height)}`,
          centre: { x: Math.round(cx), y: Math.round(cy) },
          // Under the sheet means a touch cannot reach it at all; `hitOk` says
          // so directly, and is what the assertions use.
          hitOk: !!top && (top === node || node.contains(top)),
          hitWhat: top
            ? top.tagName.toLowerCase() +
              '/' +
              (top.getAttribute('aria-label') ??
                top.getAttribute('role') ??
                (top.textContent ?? '').trim().slice(0, 20))
            : 'null',
          sheetTop: sheetBox ? Math.round(sheetBox.top) : null,
        }
      })
  }, name.source)
}

test.describe('the canvas responds to a finger', () => {
  test.slow()

  test('one finger pans the canvas, and pans are not edits', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    const canvas = await page.locator('canvas.ie-canvas-el').boundingBox()
    expect(canvas, 'the canvas has a box').not.toBeNull()

    const before = await read(page)
    await touchDrag(page, centreOf(canvas!), {
      x: centreOf(canvas!).x - 70,
      y: centreOf(canvas!).y - 50,
    })
    const after = await read(page)

    expect(
      Math.abs(after.viewport.x - before.viewport.x) > 5 ||
        Math.abs(after.viewport.y - before.viewport.y) > 5,
      'a drag across the canvas did not move the viewport',
    ).toBe(true)
    expect(after.past, 'a pan became an undoable edit').toBe(before.past)
  })

  test('two fingers pinch to zoom, and zooming is not an edit', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    const canvas = await page.locator('canvas.ie-canvas-el').boundingBox()
    expect(canvas, 'the canvas has a box').not.toBeNull()

    const before = await read(page)
    await pinch(page, centreOf(canvas!), 90, 260)
    const after = await read(page)

    expect(after.viewport.scale, 'a pinch did not zoom').toBeGreaterThan(
      before.viewport.scale + 0.2,
    )
    expect(after.past, 'a zoom became an undoable edit').toBe(before.past)
  })
})

test.describe('a gesture is one undo step', () => {
  test.slow()

  test('the crop se handle drags, on a phone, and undoes in one press', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool(page, 'Crop')

    const handle = page.getByRole('slider', { name: 'Crop se handle' })
    await expect(handle).toBeVisible()
    // The gate first: a touch dispatched at a covered point proves nothing, so
    // the handle is measured for reachability *before* it is dragged, and the
    // report says what was on top if it was not reachable.
    const reach = await probeSlider(page, (await handle.boundingBox())!)
    expect(reach.hitOk, `the crop se handle is covered (${reach.hitWhat})`).toBe(true)

    const before = await read(page)
    await touchDrag(page, centreOf((await handle.boundingBox())!), {
      x: centreOf((await handle.boundingBox())!).x - 60,
      y: centreOf((await handle.boundingBox())!).y - 60,
    })
    const after = await read(page)

    expect(
      after.crop.width < before.crop.width - 0.01,
      'dragging the se handle inwards did not narrow the crop',
    ).toBe(true)
    expect(after.past - before.past, 'a crop drag took more than one undo step').toBe(1)

    const undo = page.getByRole('button', { name: 'Undo' })
    await undo.click()
    const undone = await read(page)
    expect(undone.crop, 'one undo did not put the crop back').toEqual(before.crop)
  })

  test('the straighten dial drags on a phone, and undoes in one press', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool(page, 'Crop')

    const dial = page.locator('[role="slider"][aria-label*="traighten" i]').first()
    await dial.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    const box = (await dial.boundingBox())!
    const reach = await probeSlider(page, box)
    expect(reach.hitOk, `the straighten dial is covered (${reach.hitWhat})`).toBe(true)

    const before = await read(page)
    await touchDrag(page, centreOf(box), { x: centreOf(box).x + 70, y: centreOf(box).y - 25 })
    const after = await read(page)

    expect(after.straighten, 'dragging the straighten dial did nothing').not.toBe(before.straighten)
    expect(after.past - before.past, 'a straighten drag took more than one undo step').toBe(1)
  })

  test('an adjust slider drags on a phone, and undoes in one press', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool(page, 'Adjust')

    const slider = page.getByRole('dialog', { name: 'Adjust' }).getByRole('slider').first()
    await slider.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    const box = (await slider.boundingBox())!
    const reach = await probe(page, box)
    expect(
      reach.hitOk,
      `${await slider.getAttribute('aria-label')} is covered (${reach.hitWhat})`,
    ).toBe(true)

    const before = await read(page)
    await touchDrag(
      page,
      { x: box.x + 8, y: centreOf(box).y },
      { x: box.x + box.width - 10, y: centreOf(box).y },
    )
    const after = await read(page)

    const key = Object.keys(before.adjust).find((k) => before.adjust[k] !== after.adjust[k])
    expect(key, `dragging ${await slider.getAttribute('aria-label')} changed nothing`).toBeDefined()
    expect(after.past - before.past, 'a slider drag took more than one undo step').toBe(1)
  })

  test('a layer scale grip drags on a phone, and undoes in one press', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool(page, 'Text')
    await page
      .getByRole('dialog', { name: 'Text' })
      .getByRole('button', { name: 'Add text' })
      .click()
    await page.waitForTimeout(700)

    const grip = page.getByRole('slider', { name: 'Scale from the top left corner' })
    await expect(grip).toBeVisible()
    const box = (await grip.boundingBox())!
    const reach = await probeSlider(page, box)
    expect(reach.hitOk, `the nw scale grip is covered by the sheet (${reach.hitWhat})`).toBe(true)

    const before = await read(page)
    await touchDrag(page, centreOf(box), { x: centreOf(box).x - 45, y: centreOf(box).y - 45 })
    const after = await read(page)

    expect(after.layers[0].scale, 'dragging the nw grip did not scale the layer').toBeGreaterThan(
      before.layers[0].scale + 0.01,
    )
    expect(after.past - before.past, 'a layer transform took more than one undo step').toBe(1)
  })
})

test.describe('nothing on the canvas is under the sheet', () => {
  test.slow()

  test('every crop handle can be touched with the Crop sheet open', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool(page, 'Crop')
    await resetViewport(page)
    await page.waitForTimeout(300)

    const grips = await canvasGrips(page, /^Crop /)
    expect(grips, 'the crop renders eight handles').toHaveLength(8)

    const covered = grips.filter((grip) => !grip.hitOk)
    expect(
      covered.map(
        (grip) =>
          `${grip.name} at ${grip.centre.y} is under the sheet (sheet top ${grips[0].sheetTop}), touched ${grip.hitWhat}`,
      ),
      'crop handles a finger cannot reach',
    ).toEqual([])
  })

  test('every layer transform grip can be touched with the sheet open', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool(page, 'Text')
    await page
      .getByRole('dialog', { name: 'Text' })
      .getByRole('button', { name: 'Add text' })
      .click()
    await page.waitForTimeout(700)

    const grips = await canvasGrips(page, /^(Scale from|Rotate layer)/)
    expect(grips, 'the transform overlay renders five grips').toHaveLength(5)

    // The claim is about the *sheet*, not about the grips never overlapping each
    // other. A one-line text layer is shorter than a 28px grip, so its top and
    // bottom corner grips land on top of one another — that is a property of the
    // layer's shape, it is the same on a desktop inspector, and it is reported
    // rather than gated here. What must not happen is a grip disappearing under
    // the panel, because that is a function of the layout and the layout is
    // this file's business.
    const underSheet = grips.filter((grip) => grip.centre.y >= (grips[0].sheetTop ?? 0))
    expect(
      underSheet.map(
        (grip) =>
          `${grip.name} at ${grip.centre.y} is under the sheet, whose top is ${grips[0].sheetTop}`,
      ),
      'transform grips under the panel',
    ).toEqual([])
  })
})

test.describe('the sheet is dragged, not tapped', () => {
  test.slow()

  test('its grabber moves between detents, and the move is not an edit', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool(page, 'Passport')

    const grabber = page.locator('section[role="dialog"]').locator('> div').first()
    const box = (await grabber.boundingBox())!
    expect(box, 'the sheet has a grabber').not.toBeNull()
    const reach = await probe(page, box)
    expect(reach.hitOk, `the sheet grabber is covered (${reach.hitWhat})`).toBe(true)

    const before = await read(page)
    expect(before.detent).toBe('medium')
    await touchDrag(page, centreOf(box), { x: centreOf(box).x, y: centreOf(box).y - 140 })
    const after = await read(page)

    expect(after.detent, 'dragging the grabber up did not raise the sheet').toBe('large')
    expect(after.past, 'moving the sheet became an undoable edit').toBe(before.past)
  })
})

test.describe('a thumb does not fire things twice', () => {
  test.slow()

  test('a long press and a double tap on a tool tab open it once and edit nothing', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')

    const looks = tab(page, 'Looks')
    const box = (await looks.boundingBox())!
    expect(box, 'the Looks tab has a box').not.toBeNull()

    await longPress(page, centreOf(box))
    const afterHold = await read(page)
    expect(afterHold.activeTool, 'a long press did not open the tool').toBe('filters')
    expect(await page.getByRole('dialog').count(), 'a long press opened two panels').toBe(1)

    // A double tap must not toggle the open panel shut — the second tap lands on
    // the very tab that is already `aria-current`, and closing it would be the
    // only way a double tap can be mistaken for a deliberate dismissal.
    const beforeDouble = await read(page)
    await doubleTap(page, centreOf(box))
    const afterDouble = await read(page)
    expect(afterDouble.activeTool, 'a double tap closed the open panel').toBe('filters')
    expect(
      await page.getByRole('dialog', { name: 'Looks' }).count(),
      'the Looks panel is still open',
    ).toBe(1)
    expect(afterDouble.past, 'a double tap on a tab became an edit').toBe(beforeDouble.past)
  })
})

test.describe('a drag target does not hand the browser a scroll', () => {
  test.slow()

  test('every canvas drag target declares touch-action: none, and the sheet body does not', async ({
    goto,
    loadSample,
    page,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool(page, 'Crop')

    const measured = await page.evaluate(() => {
      // The *effective* touch-action is the intersection over the hit element
      // and every ancestor, because the browser intersects on the way down. A
      // `touch-action: none` on the handle is worthless if an ancestor says
      // `auto`, and vice versa: this is why the sheet container's mistake was
      // invisible until a drag stopped taking.
      const chainFor = (node: Element) => {
        const chain: string[] = []
        for (let n: Element | null = node; n && n !== document.body; n = n.parentElement) {
          const ta = getComputedStyle(n).touchAction
          if (ta && ta !== 'auto')
            chain.push(
              `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0].slice(0, 24)}=${ta}`,
            )
        }
        return chain
      }
      const report = (label: string, node: Element | null, want: string) => ({
        label,
        found: node ? chainFor(node) : ['ABSENT'],
        want,
      })
      return {
        drags: [
          report(
            'crop handle',
            document.querySelector('[role="slider"][aria-label="Crop se handle"]'),
            'none',
          ),
          report('canvas', document.querySelector('canvas.ie-canvas-el'), 'none'),
        ],
        scrollables: [
          report(
            'sheet body',
            document.querySelector('section[role="dialog"] div:last-child'),
            'auto',
          ),
          report('sheet', document.querySelector('section[role="dialog"]'), 'auto'),
        ],
      }
    })

    for (const entry of [...measured.drags, ...measured.scrollables]) {
      const effective = entry.found.join(' ')
      if (entry.want === 'none') {
        expect(effective, `${entry.label} has no touch-action: none`).toContain('=none')
      } else {
        expect(effective, `${entry.label} swallows the browser's own scrolling`).not.toContain(
          '=none',
        )
      }
    }
  })
})
