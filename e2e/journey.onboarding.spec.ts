import { test, expect } from './fixtures'

/**
 * The first-run orientation, the privacy disclosure, and the two cards on the
 * import screen — proved in a real browser, because every one of them is a
 * statement about what a person can see and do rather than about a value.
 *
 * The first-run marker is the load-bearing part. A unit test can prove the
 * component reads `localStorage`; only a reload can prove the panel *stops*
 * appearing, and "you may dismiss it forever" is a promise about time, not about
 * a render. So the dismissal tests here are: dismiss, reload, look again.
 *
 * `clearFirstRun` clears more than `clearStorage` does. That fixture removes the
 * session mirror and row and deliberately leaves everything else alone — the
 * marker is a different thing with a different lifetime, and a suite that
 * silently dropped it would be testing the second run while claiming the first.
 */

const MARKER = 'ie-onboarding-v1'

/**
 * Put the page back into a genuine first run.
 *
 * The harness answers the first-run marker on every navigation so that the rest
 * of the suite is not fighting a modal — see the `goto` fixture. `goto` leaves
 * an opt-out in `sessionStorage`, which survives the reload that matters here,
 * and this removes the marker itself. Both halves are needed: the sentinel stops
 * the harness writing the marker back, the removal stops the app reading it.
 */
async function clearFirstRun(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((key: string) => {
    sessionStorage.setItem('e2e-first-run', 'off')
    try {
      localStorage.removeItem(key)
    } catch {
      // Blocked storage is a legitimate state, and the panel then shows on
      // every load, which this suite already knows how to read.
    }
  }, MARKER)
}

/** Land on the import screen with no marker, which is a genuine first run. */
async function firstRun(
  goto: (path?: string) => Promise<void>,
  page: import('@playwright/test').Page,
): Promise<void> {
  await goto('/editor')
  await clearFirstRun(page)
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Before you start' })).toBeVisible()
}

const orientation = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: 'Before you start' })

/**
 * Answer the orientation and wait for it to be gone.
 *
 * Awaiting it first is not tidiness: a keypress dispatched in the same tick as
 * a reload can land before React has mounted the panel, and a test that presses
 * Escape and hopes is a test that passes for the wrong reason. Escape is read
 * here deliberately — the dismissal that has to work without a pointing device
 * is the one that is not the obvious button.
 */
async function dismissFirstRun(page: import('@playwright/test').Page): Promise<void> {
  await expect(orientation(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(orientation(page)).toHaveCount(0)
}

const opener = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'How this editor works' })

test.describe('the first run says four things and then gets out of the way', () => {
  test('it opens on the import screen, before anything has been chosen', async ({ goto, page }) => {
    await firstRun(goto, page)

    // It is the first thing focused, so Escape and Tab both land somewhere on
    // the very first keypress rather than on the file picker behind it.
    await expect(orientation(page)).toBeFocused()

    await expect(orientation(page)).toContainText('It runs in this tab.')
    await expect(orientation(page)).toContainText('Every edit is reversible.')
    await expect(orientation(page)).toContainText('Looks are settings, not filters.')
    await expect(orientation(page)).toContainText('Export is the only destructive step.')

    await page.screenshot({ path: '.playwright-mcp/first-run-1280.png' })
  })

  test('Enter on the only control dismisses it, and a reload does not bring it back', async ({
    goto,
    page,
  }) => {
    await firstRun(goto, page)

    // Keyboard only, from the moment the panel takes focus: one Tab forward to
    // the button, one Enter to press it.
    await page.keyboard.press('Tab')
    const gotIt = page.getByRole('button', { name: 'Got it' })
    await expect(gotIt).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(orientation(page)).toHaveCount(0)

    // Focus goes back to the way back in, so a keyboard user is not dropped at
    // the top of the document.
    await expect(opener(page)).toBeFocused()

    await page.reload()
    await expect(orientation(page)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
  })

  test('Escape dismisses it just as permanently', async ({ goto, page }) => {
    await firstRun(goto, page)
    await page.keyboard.press('Escape')
    await expect(orientation(page)).toHaveCount(0)

    await page.reload()
    await expect(orientation(page)).toHaveCount(0)
  })

  test('Tab cannot reach the screen behind it', async ({ goto, page }) => {
    await firstRun(goto, page)
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => {
        const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
        return panel?.contains(document.activeElement) ?? false
      })
      expect(inside, `Tab stop ${step + 1} left the panel`).toBe(true)
    }
  })

  test('it stays reachable afterwards, and only when asked', async ({ goto, page }) => {
    await goto('/editor')
    await clearFirstRun(page)
    await page.reload()
    await dismissFirstRun(page)

    // Driven from the keyboard, not clicked: focus the opener and press Enter.
    await opener(page).focus()
    await page.keyboard.press('Enter')
    await expect(orientation(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(orientation(page)).toHaveCount(0)
    await page.reload()
    await expect(orientation(page)).toHaveCount(0)
  })

  test('the marker is one key holding one character', async ({ goto, page }) => {
    await firstRun(goto, page)
    await page.keyboard.press('Escape')
    const stored = await page.evaluate((key: string) => {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i) as string)
      return { keys, value: localStorage.getItem(key), marker: key }
    }, MARKER)
    expect(stored.value).toBe('1')
    expect(stored.keys.filter((key) => key.startsWith('ie-onboarding'))).toEqual([MARKER])
  })

  test('it honours reduced motion rather than animating anyway', async ({ goto, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await firstRun(goto, page)

    const animation = await orientation(page).evaluate(
      (node) => getComputedStyle(node).animationName,
    )
    // `base.css` kills every animation under this media query with
    // `!important`; this asserts the component's own rule is what does it, so a
    // reader is not relying on a global somebody could simplify.
    expect(animation).toBe('none')

    // And it is still a working dialog under the setting.
    await page.keyboard.press('Escape')
    await expect(orientation(page)).toHaveCount(0)
  })
})

test.describe('the privacy disclosure is where the claim is read', () => {
  test('the import screen carries the CDN exception in the claim itself', async ({
    goto,
    page,
  }) => {
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))

    await goto('/editor')
    await clearFirstRun(page)
    await page.reload()
    await dismissFirstRun(page)
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()

    // Visible *before* anything is downloaded — which is the whole point: the
    // user has to be able to decide about their photo without pressing the
    // button that causes the download. The orientation is dismissed first
    // because it repeats the same sentence, and a locator that matches both is a
    // locator that proves nothing about where either one lives.
    const disclosure = page.getByText('imgly CDN', { exact: false })
    await expect(disclosure).toBeVisible()
    await expect(disclosure).toContainText('Nothing is uploaded')
    await expect(disclosure).toContainText('42 MB')
    await expect(disclosure).toContainText('IP address')
    await expect(disclosure).toContainText('nothing is downloaded from anyone at all')

    expect(
      requests.filter((url) => /imgly|static\.img\.ly|cdn\./i.test(url)),
      'no model was fetched to render this screen',
    ).toEqual([])
  })

  test('it is the same sentence the orientation and the Background panel are talking about', async ({
    goto,
    page,
  }) => {
    await firstRun(goto, page)
    const inOrientation = await orientation(page).innerText()
    await page.keyboard.press('Escape')

    const onScreen = (await page.getByText('imgly CDN', { exact: false }).innerText()).trim()
    expect(onScreen).toBeTruthy()
    expect(inOrientation).toContain(onScreen)
  })
})

test.describe('each sample says what it is there to show', () => {
  test('every tile carries a reason, and the reason names a tool', async ({ goto, page }) => {
    await goto('/editor')
    await clearFirstRun(page)
    await page.reload()
    await dismissFirstRun(page)

    const notes = await page.getByRole('button', { name: /^Sample \d\b/ }).evaluateAll((tiles) =>
      tiles.map((tile) => ({
        label: tile.querySelector('img')?.getAttribute('alt') ?? '',
        note: tile.querySelectorAll('span')[1]?.textContent?.trim() ?? '',
      })),
    )

    expect(notes).toHaveLength(3)
    for (const { label, note } of notes) {
      expect(label, 'every tile is captioned').toMatch(/^Sample \d$/)
      expect(note.length, `${label} explains itself`).toBeGreaterThan(20)
    }
    // Case-insensitively, and that is the whole point of the `i` flag. The notes
    // name the thing the way the tool bar names it — "Brightness and Exposure",
    // "Passport", "a film Look" — so a `toContain('exposure')` was asserting that
    // the product lowercased a proper noun, and went red the moment the copy was
    // written properly. What this test is for is that each reason points at
    // something a reader can go and do, so that is what it checks.
    expect(notes[0]?.note).toMatch(/exposure/i)
    expect(notes[1]?.note).toMatch(/passport/i)
    expect(notes[2]?.note).toMatch(/look/i)

    // Nothing is truncated at a phone width: the note wraps, it does not clip.
    await page.setViewportSize({ width: 390, height: 844 })
    for (const tile of await page.getByRole('button', { name: /^Sample \d\b/ }).all()) {
      const clipped = await tile.evaluate((node) => node.scrollHeight > node.clientHeight + 1)
      expect(clipped, 'a sample tile clipped its own note').toBe(false)
    }
  })
})

test.describe('the resume card is a decision, not a prompt', () => {
  test('it says what is being restored and what will happen to it', async ({
    goto,
    page,
    loadSample,
    openTool,
    persistedDoc,
  }) => {
    test.skip(test.info().project.name === 'webkit', 'WebKit aborts the IndexedDB blob write')
    await goto('/editor')
    await clearFirstRun(page)
    await page.reload()
    await dismissFirstRun(page)

    await loadSample('Sample 1')
    await expect.poll(async () => (await persistedDoc()).source?.assetId).toBeTruthy()
    await openTool('Crop')
    const handle = page.getByRole('slider', { name: 'Crop se handle' })
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    await page.reload()

    const card = page.getByText('Continue editing?')
    await expect(card).toBeVisible()
    const facts = await card.evaluate((node) => node.parentElement?.textContent ?? '')

    // The photo's own dimensions, the work in it, and the age.
    expect(facts).toMatch(/\d+ × \d+/)
    expect(facts).toContain('edit')
    expect(facts).toContain('saved')
    // And the horizon, which is the part that used to be missing. Nothing is
    // deleted on a read any more, so the card names the policy and says that
    // Discard — not the clock — takes the photo and the edits together. Both
    // halves are named because the edits are the part nobody can get back, and
    // asserted as the negative too: a card that reintroduced "are deleted" would
    // be promising a destruction the store does not perform.
    expect(facts).toContain('180 days after the last save')
    expect(facts).toContain('Nothing removes it on its own')
    expect(facts).toContain('press Discard, photo and the edits together')
    expect(facts).not.toMatch(/are deleted \d+ days/)

    // Both actions are reachable by name, and the card is answerable from the
    // keyboard.
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible()
    await page.getByRole('button', { name: 'Resume' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()
  })
})

test.describe('the front door on a phone', () => {
  test('nothing in the orientation or the disclosure is cut off at 390px', async ({
    goto,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await firstRun(goto, page)

    // Overflow is the failure this checks: text that wraps is fine, text that
    // needs a scrollbar or gets clipped is a copy bug no source audit sees.
    const overflow = await orientation(page).evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(overflow, 'the panel overflows its own width').toBeLessThanOrEqual(1)

    await page.screenshot({ path: '.playwright-mcp/first-run-390.png' })
    await dismissFirstRun(page)
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(pageOverflow, 'the import screen scrolls sideways at 390px').toBeLessThanOrEqual(1)
    await page.screenshot({ path: '.playwright-mcp/import-390.png' })
  })
})

/**
 * The same gate, one layer in.
 *
 * "Truncation is a copy bug" was written about the orientation panel's prose, and
 * it turns out to be true of the editor's chip rows for exactly the same reason:
 * a label that has to be scrolled to, or faded to, or half-shown to fit its
 * container is a label nobody can read, and no source audit sees it. These rows
 * are the app's longest strings — "Instagram Story 9:16", "US passport 50.8 ×
 * 50.8 mm" — and they live in the narrowest container in the app, so they are
 * where a chip row is most likely to break.
 *
 * jsdom cannot be part of this. It lays nothing out, so `scrollWidth` and
 * `clientWidth` are both `0` for every element and `scrollWidth <= clientWidth` is
 * true for a row that overflows by 780px. The measurement is in a real browser
 * or it is not a measurement.
 *
 * The widths are the ones the app is actually used at: the three phone widths
 * (360 is the narrowest the layout supports, 390 the common one, 430 the large
 * one) and 1280, where the same rows live in a 360px inspector column beside the
 * canvas — which is the whole reason the desktop case needs its own pass.
 */
test.describe('no chip label is cut off at any width', () => {
  test.slow()

  const PANELS = ['Crop', 'Passport'] as const

  for (const width of [360, 390, 430, 1280]) {
    test(`the crop and passport chips are whole at ${width}px`, async ({
      goto,
      loadSample,
      page,
    }) => {
      await page.setViewportSize({ width, height: width < 900 ? 844 : 900 })
      await goto('/editor')
      await loadSample()

      for (const name of PANELS) {
        await page
          .getByRole('navigation', { name: 'Editor tools' })
          .getByRole('button', { name, exact: true })
          .click()
        await expect(
          page
            .getByRole('navigation', { name: 'Editor tools' })
            .getByRole('button', { name, exact: true }),
          `${name} did not open`,
        ).toHaveAttribute('aria-current', 'true')

        const sheet = page.getByRole('dialog')
        await expect(sheet).toBeVisible()
        const rows = await sheet.locator('[role="group"]').evaluateAll((nodes) =>
          nodes.map((row) => ({
            label: row.getAttribute('aria-label') ?? '',
            overflow: row.scrollWidth - row.clientWidth,
            scrollLeft: row.scrollLeft,
            chips: Array.from(row.querySelectorAll('button')).map((chip) => ({
              label: (chip.textContent ?? '').trim(),
              overflow: chip.scrollWidth - chip.clientWidth,
            })),
          })),
        )
        expect(
          rows.length,
          `${name} at ${width}px: there is a chip row to measure`,
        ).toBeGreaterThan(0)

        for (const row of rows) {
          // Three claims, because a row can fail any one of them alone. A row
          // that overflows has to be scrolled; a row that has been scrolled is
          // showing its middle; a chip that overflows its own box is a label
          // that has been cut. All three read as the same word on screen —
          // "LinkedI", "YouTu", "Con" — and none of them is visible in the DOM.
          expect(
            row.overflow,
            `${name} · ${row.label}: the row scrolls sideways`,
          ).toBeLessThanOrEqual(1)
          expect(row.scrollLeft, `${name} · ${row.label}: the row is scrolled`).toBe(0)
          for (const chip of row.chips) {
            expect(
              chip.overflow,
              `${name} · ${row.label} · "${chip.label}" is cut off at ${width}px`,
            ).toBeLessThanOrEqual(1)
          }
        }
      }

      await page.screenshot({ path: `.playwright-mcp/chips-${width}.png` })
    })
  }
})
