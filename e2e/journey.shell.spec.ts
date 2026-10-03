import { expect, test } from './fixtures'

/**
 * The shell a person actually operates: landmarks, the skip link, the tool tab
 * bar, the help overlay, the curves editor by keyboard, and the crash screen.
 *
 * Everything here is driven the way a user drives it — Tab, arrows, Escape, and
 * clicks on things named the way they are announced — and every assertion reads
 * the live store or a measured value. Nothing locates a CSS-module class.
 */

/**
 * Safari does not Tab to links at all until "Press Tab to highlight each item
 * on a webpage" is switched on in its Advanced preferences, so the
 * "the first Tab lands on it" claim cannot hold on WebKit. `journey
 * .a11y-keys.spec.ts` says the same thing and skips that one assertion there.
 * These tests make the claim the same way: `.focus()` is engine-independent
 * and proves the link works, and the raw Tab is asserted only where it can be.
 */
const FULL_TAB_NAVIGATION = /^chromium$/

test.describe('landmarks and the skip link', () => {
  test('the Hub skip link moves focus to the main landmark', async ({
    page,
    goto,
    browserName,
  }) => {
    await goto('/')
    const link = page.getByRole('link', { name: 'Skip to content' })
    await expect(link).toHaveCount(1)
    // Parked off-screen at rest, so it is not a mouse target nobody pressed,
    // and on screen once focused — otherwise the link is a control nobody can
    // find.
    expect((await link.boundingBox())!.x).toBeLessThan(-1000)
    await link.focus()
    await expect(link).toBeFocused()
    expect((await link.boundingBox())!.x).toBeGreaterThanOrEqual(0)

    await page.keyboard.press('Enter')
    const main = page.locator('main#main')
    await expect(main).toBeFocused()

    test.skip(!FULL_TAB_NAVIGATION.test(browserName), 'Safari does not Tab to links by default')
    await page.reload()
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  })

  test('the Editor skip link moves focus to the canvas landmark', async ({
    page,
    goto,
    loadSample,
  }) => {
    // Checked on the import screen, where the skip link is the first Tab stop
    // from the top of the document — which is the only state in which "the first
    // thing a Tab reaches" is a meaningful claim. Clicking a sample moves the
    // browser's sequential-focus starting point to where that button was, so a
    // Tab from the workspace legitimately starts after the link: a keyboard user
    // passes over it on the way in, and that is what a skip link is for.
    await goto('/editor')
    const link = page.getByRole('link', { name: 'Skip to the canvas' })
    await expect(link).toHaveCount(1)
    expect((await link.boundingBox())!.x).toBeLessThan(-1000)
    await link.focus()
    await expect(link).toBeFocused()
    expect((await link.boundingBox())!.x).toBeGreaterThanOrEqual(0)
    await page.keyboard.press('Enter')
    await expect(page.locator('main#editor-main')).toBeFocused()

    // The workspace has its own, pointing at its own main landmark.
    await loadSample()
    const inWorkspace = page.getByRole('link', { name: 'Skip to the canvas' })
    await expect(inWorkspace).toHaveCount(1)
    await expect(inWorkspace).toHaveAttribute('href', '#editor-main')
    expect((await inWorkspace.boundingBox())!.x).toBeLessThan(-1000)
  })

  test('the import screen scrolls, so the samples and credits are reachable', async ({
    page,
    goto,
  }) => {
    // The editor shell is `position: fixed; inset: 0`, so the document itself has
    // nothing to scroll: `document.scrollingElement.scrollHeight` equals its
    // `clientHeight` on every route. An import screen taller than the frame
    // therefore either clips its tail or overflows invisibly, and both read
    // identically to a user — the samples and the Pexels credit are simply not
    // there. The `main` landmark is the scroll container instead.
    //
    // Asserted on both sizes rather than one, because the failure was not the
    // same at both: 1280x900 overflowed by 45px, which is the credits and
    // nothing else, and 390px overflowed by more than half a screen.
    for (const { width, height } of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width, height })
      await goto('/editor')
      await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeAttached()

      const main = page.locator('main#editor-main')
      const overflowing = await main.evaluate(
        (el) =>
          el.scrollHeight - el.clientHeight > 1 && getComputedStyle(el).overflowY !== 'visible',
      )
      expect(overflowing, `${width}x${height}: #editor-main has to be the scroll container`).toBe(
        true,
      )

      const credit = page.getByRole('link', { name: 'Pexels' })
      await expect(credit).toBeAttached()

      // A real wheel event at a real point over the content. Setting `scrollTop`
      // would prove the box is scrollable and nothing about whether it is the
      // box the browser hands the wheel to, which is the whole defect.
      const box = (await main.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, 600)
      await expect
        .poll(async () => main.evaluate((el) => el.scrollTop), { message: `${width}px: wheel` })
        .toBeGreaterThan(0)

      // And the thing under the fold is actually on screen afterwards, which is
      // what "reachable" means as opposed to "scrollable".
      await expect(credit).toBeInViewport()
    }
  })

  test('the editor has one banner, one main and one tool navigation', async ({
    page,
    goto,
    loadSample,
  }) => {
    await goto('/editor')
    await loadSample()
    await expect(page.locator('header')).toHaveCount(1)
    await expect(page.locator('main')).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Editor tools' })).toHaveCount(1)
    // Every route names itself, so a tab, a bookmark and a screen reader all
    // agree on where you are.
    await expect(page).toHaveTitle(/Editor/)
    await goto('/')
    await expect(page).toHaveTitle(/Interactive Image Editor/)
  })
})

test.describe('the tool tab bar opens a tool, it is not a toggle', () => {
  test('tapping the open tab again keeps the panel and the marker', async ({
    page,
    goto,
    loadSample,
  }) => {
    await goto('/editor')
    await loadSample()
    const tab = page
      .getByRole('navigation', { name: 'Editor tools' })
      .getByRole('button', { name: 'Export', exact: true })

    await tab.click()
    await expect(tab).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()

    // The reported bug: a second tap closed the panel and dropped
    // `aria-current`, so a user who opened Export to change the format and
    // tapped again to reach Download lost the panel.
    await tab.click()
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
    await expect(tab).toHaveAttribute('aria-current', 'true')
    await expect(
      page.getByRole('navigation', { name: 'Editor tools' }).locator('[aria-current]'),
    ).toHaveCount(1)
    // And Download is still there, which was the thing the user was after.
    await expect(page.getByRole('button', { name: /^Download/ })).toBeVisible()
  })

  test('every tool is named and reachable by keyboard', async ({ page, goto, loadSample }) => {
    await goto('/editor')
    await loadSample()
    const nav = page.getByRole('navigation', { name: 'Editor tools' })
    for (const name of ['Crop', 'Adjust', 'Export', 'Passport']) {
      await nav.getByRole('button', { name, exact: true }).focus()
      await expect(nav.getByRole('button', { name, exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-current',
        'true',
      )
    }
  })
})

test.describe('the keyboard shortcut sheet', () => {
  test('is findable without knowing the "?" key, and hands focus back', async ({
    page,
    goto,
    loadSample,
  }) => {
    await goto('/editor')
    await loadSample()
    const more = page.getByRole('button', { name: 'More options' })
    await more.click()
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()

    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet).toBeVisible()
    // Focus lands inside, so the next Tab is inside too.
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
      .toBe(true)

    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()
    await expect(more).toBeFocused()
  })

  test('opens with "?" and closes with Escape', async ({ page, goto, loadSample }) => {
    await goto('/editor')
    await loadSample()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('?')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })

  test('every listed shortcut changes the document or the view', async ({
    page,
    goto,
    loadSample,
    readDoc,
  }) => {
    await goto('/editor')
    await loadSample()
    const before = await readDoc()

    // `[` and `]` are a rotation pair; the doc field they write is checked in
    // journey.crop.spec.ts. Here the point is that the two keys the sheet lists
    // under "Rotate left/right" both reach the app at all.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press(']')
    await expect.poll(async () => (await readDoc()).geometry.orientation.quarterTurns).toBe(1)
    await page.keyboard.press('[')
    await expect.poll(async () => (await readDoc()).geometry.orientation.quarterTurns).toBe(0)

    // `f` flips horizontally.
    await page.keyboard.press('f')
    await expect.poll(async () => (await readDoc()).geometry.orientation.flipH).toBe(true)
    await page.keyboard.press('f')
    await expect.poll(async () => (await readDoc()).geometry.orientation.flipH).toBe(false)

    // The tool letters listed as "c a t b e" each open their panel.
    for (const [key, title] of [
      ['c', 'Crop & Straighten'],
      ['a', 'Adjust'],
      ['t', 'Text'],
      ['b', 'Draw'],
    ] as const) {
      await page.keyboard.press(key)
      await expect(page.getByRole('dialog', { name: title })).toBeVisible()
    }
    await page.keyboard.press('Escape')
    expect(before.geometry.orientation.quarterTurns).toBe(0)
  })
})

test.describe('the curves editor is operable by keyboard', () => {
  test('a point can be reached, nudged and removed without a pointer', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    await goto('/editor')
    await loadSample()
    await openTool('Adjust')
    await page.getByRole('button', { name: 'Curves', exact: true }).click()

    // The graph is a group, not an application: `role="application"` suppresses
    // the screen reader, which is the opposite of what a keyboard-only user
    // needs here.
    const graph = page.locator('svg[role="group"]')
    await expect(graph).toHaveAttribute('aria-label', /curves/i)
    await expect(graph).toHaveAttribute('tabindex', '0')

    // Enter on the graph adds a point.
    await graph.focus()
    await page.keyboard.press('Enter')
    const points = page.locator('svg circle[role="button"]')
    await expect(points).toHaveCount(3)

    // The new point names its own position, and the arrows move it.
    const middle = points.nth(1)
    await expect(middle).toHaveAttribute('aria-label', /input \d+, output \d+/)
    await expect(middle).toHaveAttribute('aria-label', /Delete to remove/)
    const before = await middle.getAttribute('aria-label')
    await middle.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(middle).not.toHaveAttribute('aria-label', before!)

    // The focused point has to be *visible*. `.curvePoint:focus-visible` has its
    // outline removed, so the ring element is the only focus indicator, and it
    // used never to render because the svg's own onFocus (React's `focusin`
    // bubbles) overwrote the point's index.
    await expect(page.locator('svg [data-focus-ring]')).toHaveCount(1)

    // Delete removes it again.
    await page.keyboard.press('Delete')
    await expect(points).toHaveCount(2)
    await expect(page.locator('svg [data-focus-ring]')).toHaveCount(0)
  })
})

test.describe('the crop handles are operable by keyboard', () => {
  test('arrow keys move a handle and the readout follows', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    await goto('/editor')
    await loadSample()
    await openTool('Crop')

    const handle = page.getByRole('slider', { name: 'Crop nw handle' })
    await expect(handle).toHaveAttribute('tabindex', '0')
    const width = await handle.getAttribute('aria-valuenow')
    await expect(handle).toHaveAttribute('aria-valuetext', /% of the frame wide/)

    await handle.focus()
    await expect(handle).toBeFocused()
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight')
    await expect(handle).not.toHaveAttribute('aria-valuenow', width!)
    await expect(Number(await handle.getAttribute('aria-valuenow'))).toBeLessThan(100)

    // The chip row has to agree with the crop it is labelling. After this drag
    // the box is no longer the ratio the lock was holding, and the lit chip has
    // to stop claiming it is. Read the ratio out of the panel's own text rather
    // than by class name: the readout and the chip row are the two things that
    // must not disagree, so both are read the way a reader reads them.
    // The readout is painted on the canvas overlay, not inside the sheet, and
    // it reports the crop in source pixels — so a narrow box reads "0.60:1"
    // rather than anything like a named preset. The regex has to allow the
    // decimal the app actually prints.
    const shown = await expect
      .poll(async () => {
        const text = await page.evaluate(() => document.body.textContent ?? '')
        return text.match(/px · ([\d.]+:\d+)/)?.[1] ?? null
      })
      .not.toBeNull()
      .then(() =>
        page.evaluate(() => document.body.textContent?.match(/px · ([\d.]+:\d+)/)?.[1] ?? ''),
      )
    expect(shown).toMatch(/^[\d.]+:\d+$/)

    const presets = page.getByRole('group', { name: 'Aspect ratio presets' })
    const litChip = (await presets.locator('[aria-pressed="true"]').textContent())?.trim() ?? ''
    if (/^\d+:\d+$/.test(litChip)) expect(litChip).toBe(shown)
  })

  test('Reset crop puts the lit chip back in step with the readout', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    await goto('/editor')
    await loadSample()
    await openTool('Crop')
    const presets = page.getByRole('group', { name: 'Aspect ratio presets' })
    await presets.getByRole('button', { name: '16:9', exact: true }).click()
    await expect(presets.getByRole('button', { name: '16:9', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // The reported bug: Reset crop released the box, the canvas readout went
    // back to the photo's own 2:3, and the chip row kept lighting "16:9"
    // because it was reading the aspect *lock* rather than the crop.
    await page.getByRole('button', { name: 'Reset crop' }).click()
    const readout = page.getByText(/px · \d+:\d+/)
    await expect(readout).toContainText('2:3')
    await expect(presets.locator('[aria-pressed="true"]')).toHaveCount(1)
    await expect(presets.locator('[aria-pressed="true"]')).toHaveText('2:3')
  })
})

test.describe('a watermark is reachable, not just creatable', () => {
  test('the Text panel opens an inspector for one and the controls do something', async ({
    page,
    goto,
    loadSample,
    openTool,
    readDoc,
  }) => {
    await goto('/editor')
    await loadSample()
    // "Add watermark" used to live at the bottom of a *text* layer's inspector,
    // so a document with no text layer could not add one at all.
    await openTool('Text')
    await expect(page.getByRole('button', { name: 'Add text' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Add watermark' }).click()

    const panel = page.getByRole('dialog', { name: 'Text' })
    const textBox = panel.getByRole('textbox', { name: 'Watermark text' })
    await expect(textBox).toBeVisible()

    // Editing the mark reaches the document.
    await textBox.fill('© Studio')
    await expect
      .poll(async () => {
        const layers = (await readDoc()).layers
        return layers.find((l) => l.kind === 'watermark')?.text
      })
      .toBe('© Studio')

    // The anchor the compositor actually resolves.
    const anchor = panel.getByLabel('Anchor')
    await expect(anchor).toHaveValue('bottom-right')
    await anchor.selectOption('top-left')
    await expect
      .poll(async () => {
        const layers = (await readDoc()).layers
        const mark = layers.find((l) => l.kind === 'watermark')
        return mark && 'anchor' in mark ? mark.anchor : null
      })
      .toBe('top-left')

    // The position control is an *offset* from the anchor, not a place. It used
    // to be a 0-100% "X" slider, so a slider reading 20% put the mark at 65% —
    // 45 points away from the corner it was resting in.
    const offset = panel.getByRole('slider', { name: /^Offset X/ })
    await expect(offset).toBeVisible()
    await expect(panel.getByRole('slider', { name: /^Offset X/ })).toHaveValue('0')
    await offset.focus()
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowRight')
    await expect(offset).toHaveValue('12')
    await expect
      .poll(async () => {
        const layers = (await readDoc()).layers
        const mark = layers.find((l) => l.kind === 'watermark')
        return mark ? mark.transform.x : null
      })
      .toBeCloseTo(0.62, 2)

    // Tiling is a real toggle, and so is scale.
    const tile = panel.getByRole('button', { name: 'Tile across the image' })
    await expect(tile).toHaveAttribute('aria-pressed', 'false')
    await tile.click()
    await expect
      .poll(async () => {
        const layers = (await readDoc()).layers
        const mark = layers.find((l) => l.kind === 'watermark')
        return mark && 'tiled' in mark ? mark.tiled : null
      })
      .toBe(true)

    // And it can be removed, which it also could not before.
    await panel.getByRole('button', { name: 'Delete layer' }).click()
    await expect
      .poll(async () => (await readDoc()).layers.filter((l) => l.kind === 'watermark').length)
      .toBe(0)
  })
})

test.describe('the desktop inspector does not trap a keyboard user', () => {
  test('Tab escapes the panel to the top bar', async ({ page, goto, loadSample, openTool }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample()
    const panel = await openTool('Adjust')

    // Above the breakpoint the sheet is a column, not a modal: no `aria-modal`,
    // no Tab wrap. It used to be a trap, which made the canvas and the Undo
    // button unreachable by keyboard once a panel was open.
    await expect(panel).not.toHaveAttribute('aria-modal', 'true')

    await panel.getByRole('button', { name: 'Auto' }).focus()
    await page.keyboard.press('Tab')
    const escaped = await page.evaluate(() => {
      const a = document.activeElement
      return !a?.closest('[role="dialog"]')
    })
    expect(escaped).toBe(true)
  })

  test('the inspector is a column between the two bars and does not cover the canvas', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample()
    const panel = await openTool('Adjust')
    const box = (await panel.boundingBox())!
    const viewport = page.viewportSize()!
    const topBar = (await page.getByRole('banner').boundingBox())!
    const tabBar = (await page.getByRole('navigation', { name: 'Editor tools' }).boundingBox())!

    // It fills exactly the space between the bars — a column, not a sheet over
    // the app. These two lines are the whole of the desktop defect: the panel
    // was `position: fixed` with `top: 0; bottom: 0`, which resolved against
    // the *viewport*, so it covered the top bar's right-hand buttons and the
    // right-hand tool tabs and clipped Export to "Ex".
    expect(box.y).toBeGreaterThanOrEqual(topBar.y + topBar.height - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(tabBar.y + 1)
    // Nearly all of the window, not 58vh of it with dead space underneath.
    expect(box.height).toBeGreaterThan(viewport.height * 0.7)

    const canvas = (await page.locator('canvas.ie-canvas-el').boundingBox())!
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(box.x + 1)
  })
})

test.describe('the crash screen is a recovery, not a blank page', () => {
  test('a render error offers a way out', async ({ page, goto }) => {
    // `?crash=1` makes a real component throw during render. There is no user
    // action that does this on demand, so the boundary had a unit test and
    // nothing else — which is not evidence it works in a real page.
    await goto('/editor?crash=1')
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('Something went wrong')
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(alert.getByRole('button', { name: 'Reload' })).toBeVisible()
    // And it must not claim a moment it cannot know: this boundary wraps the
    // whole app for the whole session, not just the boot.
    await expect(alert).not.toContainText(/finish loading/i)
  })
})

test.describe('the hub does not call anyone', () => {
  test('loads no third-party resource', async ({ page, goto }) => {
    const thirdParty: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (
        !url.startsWith('http://127.0.0.1') &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:')
      ) {
        thirdParty.push(url)
      }
    })
    await goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // "100% client-side", "no uploads, no accounts" and a network panel with a
    // googleapis row are two different stories. The webfont links in index.html
    // made the marketing false.
    expect(thirdParty).toEqual([])
  })
})

test.describe('reduced motion', () => {
  test('nothing animates or transitions', async ({ page, goto, loadSample, openTool }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await goto('/editor')
    await loadSample()
    await openTool('Adjust')
    await expect
      .poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
      .toBe(true)
    const moving = await page.evaluate(() => {
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const cs = getComputedStyle(el)
        if (cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) {
          out.push(
            `${el.tagName}.${String(el.className).slice(0, 30)} transition ${cs.transitionDuration}`,
          )
        }
        if (cs.animationName && cs.animationName !== 'none') {
          out.push(
            `${el.tagName}.${String(el.className).slice(0, 30)} animation ${cs.animationName}`,
          )
        }
      }
      return out
    })
    expect(moving).toEqual([])
    // And the page is still usable, which is the point of honouring it.
    await expect(page.getByRole('slider', { name: 'Exposure' })).toBeVisible()
  })
})

test.describe('forced colours', () => {
  test('the dial shows its value instead of a blank bar', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await goto('/editor')
    await loadSample()
    await openTool('Adjust')

    const dial = page.getByRole('slider', { name: 'Exposure' })
    await dial.focus()
    const before = await dial.getAttribute('aria-valuenow')
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight')
    await expect(dial).not.toHaveAttribute('aria-valuenow', before!)

    // The forced-colors rules used to set `background: CanvasText` on the tick
    // rulers, and that shorthand also clears `background-image`, so the whole
    // track rendered as a solid block with a CanvasText needle painted on top of
    // it: a value you could drag and could not see. The needle has to be a
    // system colour, and visibly different from the track behind it.
    // Forced-colors mode drops `background-image` on every element, so the tick
    // gradient cannot come back and the value has to be carried by the pair: a
    // track that is not the panel background, and a needle that is not the
    // track. Both were `CanvasText` before, which is a blank bar.
    const painted = await page.evaluate(() => {
      const track = document.querySelector('[role="slider"][aria-label="Exposure"]')
      if (!track) return null
      const needle = Array.from(track.querySelectorAll<HTMLElement>('div')).find(
        (node) => getComputedStyle(node).pointerEvents === 'none',
      )
      if (!needle) return null
      const trackStyle = getComputedStyle(track)
      return {
        needle: getComputedStyle(needle).backgroundColor,
        track: trackStyle.backgroundColor,
        trackBorder: trackStyle.borderTopWidth,
        panel: getComputedStyle(track.parentElement ?? document.body).backgroundColor,
      }
    })
    expect(painted).not.toBeNull()
    expect(painted!.needle).not.toBe(painted!.track)
    expect(painted!.track).not.toBe(painted!.panel)
    expect(Number.parseFloat(painted!.trackBorder)).toBeGreaterThan(0)
  })
})
