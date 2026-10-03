import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * The Adjust panel's three sub-panels, and the two things they were failing to
 * say: which curve is the one you are dragging, and which colour a "Red" band
 * actually means.
 *
 * Everything here is located by role or accessible name. A `styles.foo`
 * selector would pass just as happily against a panel whose controls a keyboard
 * or screen-reader user cannot reach — which is the exact failure these panels
 * had.
 */

/** The open Adjust sheet, addressed the way the fixtures address a tool. */
const sheet = 'Adjust'

/** Switch to one of Sliders / Curves / Colour bands. */
async function openSection(page: Page, name: 'Sliders' | 'Curves' | 'Colour bands') {
  const group = page.getByRole('group', { name: 'Adjustment section' })
  await group.getByRole('button', { name, exact: true }).click()
  await expect(group.getByRole('button', { name, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
}

test.describe('the Adjust panel names what it is doing', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, openTool, settle, page }) => {
    await goto('/editor')
    await clearStorage()
    await goto('/editor')
    await loadSample('Sample 1')
    await settle()
    await openTool('Adjust')
    await expect(page.getByRole('dialog', { name: sheet })).toBeVisible()
  })

  test('the Auto button says what it sets, not just "Auto"', async ({ page }) => {
    const auto = page.getByRole('button', { name: 'Auto tone' })
    await expect(auto).toBeVisible()
    await expect(page.getByRole('button', { name: 'Auto', exact: true })).toHaveCount(0)

    // The title is the only place the six parameters fit, so it is the place
    // they have to be true. Checked against the labels the rings above it use,
    // so a renamed slider cannot leave the sentence describing the old one.
    const title = (await auto.getAttribute('title')) ?? ''
    for (const label of [
      'Exposure',
      'Brightness',
      'Black Point',
      'Contrast',
      'Highlights',
      'Shadows',
    ]) {
      expect(title, label).toContain(label)
      await expect(
        page.getByRole('toolbar', { name: 'Adjustment parameters' }).getByRole('button', {
          name: new RegExp(`^${label} `),
        }),
      ).toHaveCount(1)
    }
  })

  test('the Auto tone toast names the sliders it moved, and repeats the button', async ({
    page,
  }) => {
    // "Auto set Exposure" is true of a run that moved one slider and a run that
    // moved six, and the toast is the only place a user can read what happened
    // while the panel is behind it. It repeats the button's own name so the two
    // refer to the same control rather than to two words for one.
    //
    // Which sliders moved depends on the photo, so the assertion is the shape:
    // the button's name, then a list of the panel's own slider labels. The old
    // "Auto set …" prefix is the thing that must not come back.
    await page.getByRole('button', { name: 'Auto tone' }).click()
    const toast = page.getByRole('status').filter({ hasText: /^Auto tone set / })
    await expect(toast).toBeVisible()
    await expect(toast).toHaveText(
      /^Auto tone set (Exposure|Brightness|Black Point|Contrast|Highlights|Shadows)(, (Exposure|Brightness|Black Point|Contrast|Highlights|Shadows))*$/,
    )
    await expect(page.getByText(/^Auto set /)).toHaveCount(0)
  })

  test('Brilliance and Brightness each say what they do, and nothing else does', async ({
    page,
  }) => {
    const rings = page.getByRole('toolbar', { name: 'Adjustment parameters' })

    await rings.getByRole('button', { name: /^Brilliance/ }).click()
    await expect(page.getByText(/weighted to the midtones/)).toBeVisible()

    await rings.getByRole('button', { name: /^Brightness/ }).click()
    await expect(page.getByText(/A flat offset added to every pixel/)).toBeVisible()

    // A ring with an explanation next to it, so the pairing is not a coincidence
    // of the panel's layout.
    await rings.getByRole('button', { name: /^Contrast/ }).click()
    await expect(page.getByText(/weighted to the midtones/)).toHaveCount(0)
    await expect(page.getByText(/A flat offset added to every pixel/)).toHaveCount(0)
  })

  test('all fifteen adjustment rings render their own mark', async ({ page }) => {
    const rings = page.getByRole('toolbar', { name: 'Adjustment parameters' }).getByRole('button')
    await expect(rings).toHaveCount(15)

    const shapes = await page.evaluate(() => {
      const toolbar = document.querySelector('[role="toolbar"]')!
      return Array.from(toolbar.querySelectorAll('button')).map((ring) => {
        const svgs = ring.querySelectorAll('svg')
        return svgs[svgs.length - 1]?.innerHTML ?? ''
      })
    })
    // Fifteen identical marks would be the generic glyph repeated fifteen times,
    // which is what the eye lands on and finds nothing in.
    expect(shapes.filter(Boolean)).toHaveLength(15)
    expect(new Set(shapes).size).toBe(15)
  })
})

test.describe('the curve graph is legible before it is touched', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, openTool, settle, page }) => {
    await goto('/editor')
    await clearStorage()
    await goto('/editor')
    await loadSample('Sample 1')
    await settle()
    await openTool('Adjust')
    await openSection(page, 'Curves')
  })

  test('every channel is drawn and the selected one is the thick one', async ({ page }) => {
    const graph = page.getByRole('group', { name: /curves/i })
    await expect(graph).toBeVisible()

    const strokes = await page.evaluate(() => {
      const svg = document.querySelector('[role="group"][aria-label*="curves"]')!
      return Array.from(svg.querySelectorAll('path[data-curve-channel]')).map((node) => ({
        channel: node.getAttribute('data-curve-channel'),
        stroke: node.getAttribute('stroke'),
        width: Number(node.getAttribute('stroke-width')),
        opacity: Number(node.getAttribute('stroke-opacity')),
        active: node.getAttribute('data-curve-active'),
      }))
    })
    expect(strokes).toHaveLength(4)
    expect(new Set(strokes.map((s) => s.channel)).size).toBe(4)
    // Four colours, not one.
    expect(new Set(strokes.map((s) => s.stroke)).size).toBe(4)

    const active = strokes.filter((s) => s.active === 'true')
    expect(active).toHaveLength(1)
    expect(active[0].opacity).toBe(1)
    for (const recessive of strokes.filter((s) => s.active === 'false')) {
      // Recessive is a width *and* an opacity difference, so the selected line is
      // still the obvious one with colour removed.
      expect(recessive.width).toBeLessThan(active[0].width)
      expect(recessive.opacity).toBeLessThan(1)
    }
  })

  test('each chip carries the colour of the curve it selects', async ({ page }) => {
    const chips = page.getByRole('group', { name: 'Curve channel' })
    await expect(chips.getByRole('button')).toHaveCount(4)
    // The chips are the legend: name, colour and pressed state in one control,
    // which is why the panel has no separate key.
    for (const name of ['RGB', 'Red', 'Green', 'Blue']) {
      await expect(chips.getByRole('button', { name, exact: true })).toHaveCount(1)
    }

    const dots = await page.evaluate(() => {
      const group = document.querySelector('[role="group"][aria-label="Curve channel"]')!
      return Array.from(group.querySelectorAll('button')).map((button) => ({
        label: button.textContent?.trim(),
        pressed: button.getAttribute('aria-pressed'),
        dot: getComputedStyle(button.querySelector('span')!).backgroundColor,
        hidden: button.querySelector('span')!.getAttribute('aria-hidden'),
      }))
    })
    expect(dots.map((d) => d.label)).toEqual(['RGB', 'Red', 'Green', 'Blue'])
    // The dot is decorative: the accessible name is still the channel name.
    expect(dots.every((d) => d.hidden === 'true')).toBe(true)
    expect(new Set(dots.map((d) => d.dot)).size).toBe(4)
  })

  test('selecting a channel moves the emphasis and repaints the curve', async ({
    page,
    readDoc,
  }) => {
    const chips = page.getByRole('group', { name: 'Curve channel' })
    await chips.getByRole('button', { name: 'Green', exact: true }).click()
    await expect(chips.getByRole('button', { name: 'Green', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The point handles belong to the selected channel, and they name it.
    await expect(page.getByRole('button', { name: /^Green curve point 1 of 2/ })).toHaveCount(1)

    // And the graph is still editable from the keyboard on the new channel.
    const graph = page.getByRole('group', { name: /^Green curves/ })
    await graph.focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readDoc()).curves.g.length).toBe(3)
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await readDoc()).curves.g[1].y).toBe(129)
    // The composite curve was not touched.
    expect((await readDoc()).curves.rgb).toHaveLength(2)
    await page.screenshot({ path: '.playwright-mcp/adjust-curves-green.png' })
  })

  test('the curve is still editable with a keyboard alone', async ({ page, readDoc }) => {
    const graph = page.getByRole('group', { name: /curves/i })
    await graph.focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readDoc()).curves.rgb.length).toBe(3)
    await expect(page.getByRole('button', { name: /curve point 2 of 3/ })).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(async () => (await readDoc()).curves.rgb[1]).toEqual({ x: 138, y: 129 })
  })
})

test.describe('the colour bands name the pixels they change', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, openTool, settle, page }) => {
    await goto('/editor')
    await clearStorage()
    await goto('/editor')
    await loadSample('Sample 1')
    await settle()
    await openTool('Adjust')
    await openSection(page, 'Colour bands')
  })

  test('offers all eight bands, each with its own colour', async ({ page }) => {
    const bands = page.getByRole('group', { name: 'Colour bands' })
    // The group was called "Color band", which is also the name of one of the
    // eight. Both spellings have to be gone before this test can be called green.
    await expect(page.getByRole('group', { name: 'Color band' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Colour bands' })).toHaveCount(1)
    const chips = bands.getByRole('button')
    await expect(chips).toHaveCount(8)
    await expect(chips).toHaveText([
      'Red',
      'Orange',
      'Yellow',
      'Green',
      'Aqua',
      'Blue',
      'Purple',
      'Magenta',
    ])

    const swatches = await page.evaluate(() => {
      const group = document.querySelector('[role="group"][aria-label="Colour bands"]')!
      return Array.from(group.querySelectorAll('button')).map((button) => {
        const dot = button.querySelector('span')!
        const box = dot.getBoundingClientRect()
        return {
          name: button.textContent?.trim(),
          colour: getComputedStyle(dot).backgroundColor,
          hidden: dot.getAttribute('aria-hidden'),
          wide: Math.round(box.width),
          tall: Math.round(box.height),
        }
      })
    })
    // The swatch is the mapping between the word and the pixels, so it has to be
    // a real area to judge and a colour of its own.
    expect(new Set(swatches.map((s) => s.colour)).size).toBe(8)
    for (const swatch of swatches) {
      expect(swatch.hidden, swatch.name ?? '').toBe('true')
      expect(swatch.wide, swatch.name ?? '').toBeGreaterThanOrEqual(10)
      expect(swatch.tall, swatch.name ?? '').toBeGreaterThanOrEqual(10)
    }
  })

  test('an edit reaches the document and the band marks itself as touched', async ({
    page,
    readDoc,
  }) => {
    const saturation = page.getByRole('slider', { name: /^Saturation/ })
    await saturation.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await readDoc()).hsl.red.sat).toBe(2)
    await expect(page.getByText(/Editing the Red band/)).toBeVisible()

    // And the panel tells the user the thing it used to claim about portrait tools.
    await expect(page.getByText(/portrait/i)).toHaveCount(0)
  })
})
