import { expect } from '@playwright/test'
import { test } from './fixtures'
import { installMatte } from './store'
import type { Doc } from '../src/model/types'

/**
 * D3-F11 / D3-F19 / D3-F12 / D3-F14 / D3-F20 — the matte, measured on exported
 * pixels.
 *
 * `journey.matte.spec.ts` had to measure the AssetStore instead of an export,
 * and said why in its header: the GL background shader did not compile for an
 * alpha-bearing source, so "encoding any matte document throws". Two things were
 * wrong with that, and both are fixed:
 *
 * 1. `BACKGROUND_FRAG` assigned a `vec4` into a `vec3` accumulator, so the
 *    program never linked. (`e2e/shader-compile.spec.ts` now gates that.)
 * 2. `GlRenderer.whiteImage` uploaded a `{width, height, data}` object as a
 *    `TexImageSource`, which is not one, so `texImage2D` threw on overload
 *    resolution — the "contain letterbox shows the matte colour" path was
 *    unreachable for the same reason.
 *
 * So the claims are measurable the honest way now: render the document through
 * the real export path and read the pixels back. `installMatte` is the same
 * commit `handleRemove` makes (an AssetStore entry the document points at)
 * without the 42 MB model download, so the pipeline under test is the real one
 * on a real alpha-bearing source.
 */

type Rgba = [number, number, number, number]

type Alpha = {
  size: { width: number; height: number }
  /** Share of pixels with alpha below 250. */
  transparentFraction: number
  /** Mean alpha of the top and bottom fifths. */
  topMean: number
  bottomMean: number
  /**
   * Fixed sample points as plain arrays. `page.evaluate` serialises its result
   * over the wire, so a returned closure arrives as nothing and `result.at(...)`
   * would be `undefined is not a function`.
   */
  samples: Record<string, Rgba>
}

/** Away from the edges, and spread across the frame. */
const POINTS: Array<[string, number, number]> = [
  ['centre', 0.5, 0.5],
  ['topMid', 0.5, 0.08],
  ['bottomMid', 0.5, 0.92],
  ['topLeft', 0.06, 0.06],
  ['topRight', 0.94, 0.06],
  ['bottomLeft', 0.06, 0.94],
  ['bottomRight', 0.94, 0.94],
  ['leftMid', 0.04, 0.5],
  ['rightMid', 0.96, 0.5],
]

async function exportAlpha(page: Parameters<typeof installMatte>[0]): Promise<Alpha> {
  return page.evaluate(
    async (points) => {
      const base = document.baseURI
      const store = await import(/* @vite-ignore */ new URL('src/store/docStore.ts', base).href)
      const assets = await import(
        /* @vite-ignore */ new URL('src/model/assetsSingleton.ts', base).href
      )
      const mod = await import(/* @vite-ignore */ new URL('src/render/exportCanvas.ts', base).href)
      const doc = store.useDocStore.getState().present
      if (!doc.source) throw new Error('the document has no source')
      const source = assets.assetStore.get(doc.source.assetId)
      if (!source) throw new Error('the source asset is missing from the store')
      const width = 160
      const canvas = await mod.renderExportCanvas(source, doc, {
        width,
        height: Math.max(1, Math.round((width * doc.source.height) / doc.source.width)),
      })
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('no 2d context on the export canvas')
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let transparent = 0
      const bandMean = (from: number, to: number) => {
        let sum = 0
        let n = 0
        for (let y = Math.floor(from * canvas.height); y < Math.floor(to * canvas.height); y += 1) {
          for (let x = 0; x < canvas.width; x += 2) {
            sum += d[(y * canvas.width + x) * 4 + 3]
            n += 1
          }
        }
        return n > 0 ? sum / n : 0
      }
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) transparent += 1
      const samples: Record<string, [number, number, number, number]> = {}
      for (const [name, fx, fy] of points) {
        const x = Math.min(canvas.width - 1, Math.max(0, Math.round(fx * (canvas.width - 1))))
        const y = Math.min(canvas.height - 1, Math.max(0, Math.round(fy * (canvas.height - 1))))
        const i = (y * canvas.width + x) * 4
        samples[name] = [d[i], d[i + 1], d[i + 2], d[i + 3]]
      }
      return {
        size: { width: canvas.width, height: canvas.height },
        transparentFraction: transparent / (canvas.width * canvas.height),
        topMean: bandMean(0, 0.2),
        bottomMean: bandMean(0.8, 1),
        samples,
      }
    },
    POINTS as Array<[string, number, number]>,
  )
}

/**
 * A matte that keeps a horizontal *band* and cuts away everything above and below
 * it. `installMatte` can only keep the top of the frame, which leaves the top of
 * the export opaque - useless for reading a gradient, whose two ends both have to
 * be in the cut-out. This is the same commit `installMatte` makes.
 */
async function installBandMatte(
  page: Parameters<typeof installMatte>[0],
  from: number,
  to: number,
): Promise<void> {
  await page.evaluate(
    async ({ from: top, to: bottom }) => {
      const base = document.baseURI
      const store = await import(/* @vite-ignore */ new URL('src/store/docStore.ts', base).href)
      const assets = await import(
        /* @vite-ignore */ new URL('src/model/assetsSingleton.ts', base).href
      )
      const doc = store.useDocStore.getState().present
      const source = assets.assetStore.get(doc.source.assetId)
      if (!source) throw new Error('the source asset is missing from the store')
      const c = new OffscreenCanvas(source.width, source.height)
      const g = c.getContext('2d')
      if (!g) throw new Error('no 2d context')
      g.drawImage(source as CanvasImageSource, 0, 0)
      g.globalCompositeOperation = 'destination-in'
      g.fillStyle = '#000000'
      g.fillRect(0, source.height * top, source.width, source.height * (bottom - top))
      const id = assets.assetStore.add(await createImageBitmap(c))
      store.useDocStore.getState().update((d: Doc) => ({
        ...d,
        source: { ...d.source, assetId: id, width: source.width, height: source.height },
        background: { ...d.background, removed: true },
      }))
    },
    { from, to },
  )
}

/**
 * The document's output format, which decides the contract: JPEG and PDF
 * flatten onto the matte, PNG/WebP/AVIF keep the alpha. The default is JPEG, so
 * an alpha claim has to say which format it means.
 */
async function setFormat(
  page: Parameters<typeof installMatte>[0],
  format: 'png' | 'jpeg',
): Promise<void> {
  await page.evaluate(async (f) => {
    const base = document.baseURI
    const store = await import(/* @vite-ignore */ new URL('src/store/docStore.ts', base).href)
    store.useDocStore
      .getState()
      .update((doc: Doc) => ({ ...doc, output: { ...doc.output, format: f } }))
  }, format)
}

async function setBackground(
  page: Parameters<typeof installMatte>[0],
  patch: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(async (p) => {
    const base = document.baseURI
    const store = await import(/* @vite-ignore */ new URL('src/store/docStore.ts', base).href)
    store.useDocStore.getState().update((doc: Doc) => ({
      ...doc,
      background: { ...doc.background, ...p },
    }))
  }, patch)
}

test.describe('the subject matte reaches the exported pixels', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test.beforeEach(async ({ page }) => {
    await setFormat(page, 'png')
  })

  test('an un-matted document exports fully opaque', async ({ page }) => {
    const before = await exportAlpha(page)
    expect(before.transparentFraction).toBe(0)
    expect(before.samples.bottomMid[3]).toBe(255)
  })

  test('D3-F11/D3-F19: a matte survives the whole pipeline into the exported alpha', async ({
    page,
    settle,
  }) => {
    await installMatte(page, 0.6)
    await settle()
    const after = await exportAlpha(page)
    // The bottom 40% of the frame was cut away and nothing else was.
    expect(after.transparentFraction).toBeGreaterThan(0.3)
    expect(after.transparentFraction).toBeLessThan(0.5)
    expect(after.topMean).toBeGreaterThan(250)
    expect(after.bottomMean).toBeLessThan(5)
    expect(after.samples.topMid[3]).toBeGreaterThan(250)
    expect(after.samples.bottomMid[3]).toBeLessThan(5)
  })

  test('D3-F19: a JPEG export flattens the cut-out onto the matte colour', async ({
    page,
    settle,
  }) => {
    await installMatte(page, 0.6)
    await setFormat(page, 'jpeg')
    await page.getByRole('button', { name: 'Adjust', exact: true }).click()
    await settle()
    const flat = await exportAlpha(page)
    expect(flat.transparentFraction).toBe(0)
    // The matte colour, not transparent: the cut-out is gone and white is behind it.
    expect(flat.samples.bottomLeft).toEqual([255, 255, 255, 255])
  })

  test('D3-F19: a colour background flattens the frame and the alpha with it', async ({
    page,
    settle,
  }) => {
    await installMatte(page, 0.6)
    await setBackground(page, { mode: 'color', color: '#ff0000' })
    await settle()
    const flat = await exportAlpha(page)
    // A colour background is opaque by construction, and red.
    expect(flat.transparentFraction).toBe(0)
    const corner = flat.samples.bottomLeft
    expect(corner[0]).toBeGreaterThan(240)
    expect(corner[1]).toBeLessThan(15)
    expect(corner[2]).toBeLessThan(15)
    expect(flat.samples.topMid[3]).toBe(255)
  })

  test('D3-F14: gradient 0 runs top to bottom and 90 runs left to right', async ({
    page,
    settle,
  }) => {
    // A band, so that the top *and* the bottom of the export are both showing the
    // gradient. With a top-anchored cut-out the top of the frame is the
    // photograph, and the assertion below would be reading the photo.
    await installBandMatte(page, 0.4, 0.6)
    const gradient = { from: '#0000ff', to: '#ffff00' }
    await setBackground(page, { mode: 'gradient', gradient: { ...gradient, angle: 0 } })
    await settle()
    const down = await exportAlpha(page)
    await setBackground(page, { mode: 'gradient', gradient: { ...gradient, angle: 90 } })
    await settle()
    const across = await exportAlpha(page)
    await setBackground(page, { mode: 'gradient', gradient: { ...gradient, angle: 45 } })
    await settle()
    const diag = await exportAlpha(page)

    // `from` is #0000ff and `to` is #ffff00, so yellow is high red / low blue
    // and blue is the other way round. Every sample below is in the cut-out, so
    // what is being read is the gradient and not the photograph.
    // 0 degrees: `to` at the bottom, `from` at the top.
    expect(down.samples.bottomLeft[0]).toBeGreaterThan(200)
    expect(down.samples.bottomLeft[2]).toBeLessThan(80)
    expect(down.samples.topLeft[0]).toBeLessThan(80)
    expect(down.samples.topLeft[2]).toBeGreaterThan(200)
    // The ramp has to vary across the frame at all, and the row-to-row polarity
    // above is what says the direction is right rather than merely non-constant.
    expect(down.samples.bottomLeft[0]).toBeGreaterThan(down.samples.topLeft[0])
    expect(down.samples.bottomLeft[0] - down.samples.topLeft[0]).toBeGreaterThan(100)

    // 90 degrees: `to` at the right, `from` at the left.
    expect(across.samples.bottomRight[0]).toBeGreaterThan(200)
    expect(across.samples.bottomRight[2]).toBeLessThan(80)
    expect(across.samples.bottomLeft[2]).toBeGreaterThan(200)
    expect(across.samples.bottomLeft[0]).toBeLessThan(80)
    expect(across.samples.bottomRight[0]).toBeGreaterThan(across.samples.bottomLeft[0])

    // 45 is neither, at either end.
    expect(diag.samples.bottomLeft).not.toEqual(down.samples.bottomLeft)
    expect(diag.samples.bottomRight).not.toEqual(across.samples.bottomRight)
  })

  test('D3-F12: an image background covers, contains and blurs differently', async ({
    page,
    settle,
  }) => {
    // A band again: the fit has to be read where the background actually shows.
    await installBandMatte(page, 0.4, 0.6)
    const assetId = await page.evaluate(async () => {
      const base = document.baseURI
      const assets = await import(
        /* @vite-ignore */ new URL('src/model/assetsSingleton.ts', base).href
      )
      const store = await import(/* @vite-ignore */ new URL('src/store/docStore.ts', base).href)
      // Deliberately not the frame's aspect ratio, so cover and contain differ.
      const c = new OffscreenCanvas(400, 100)
      const g = c.getContext('2d')
      if (!g) throw new Error('no 2d context')
      g.fillStyle = '#00ff00'
      g.fillRect(0, 0, 400, 100)
      g.fillStyle = '#ff00ff'
      g.fillRect(0, 0, 400, 50)
      g.fillStyle = '#000000'
      for (let y = 0; y < 100; y += 10) {
        for (let x = 0; x < 400; x += 10) g.fillRect(x, y, 5, 5)
      }
      const id = assets.assetStore.add(await createImageBitmap(c))
      store.useDocStore.getState().update((doc: Doc) => ({
        ...doc,
        background: {
          ...doc.background,
          mode: 'image',
          imageAssetId: id,
          fit: 'cover',
          blur: 0,
          color: '#00ff00',
        },
      }))
      return id
    })
    expect(assetId).toMatch(/^asset_/)
    await settle()
    const cover = await exportAlpha(page)
    await setBackground(page, { fit: 'contain' })
    await settle()
    const contain = await exportAlpha(page)
    await setBackground(page, { fit: 'cover', blur: 0.9 })
    await settle()
    const blurred = await exportAlpha(page)

    // A background image is opaque, and the cut-out stays opaque either way.
    expect(cover.transparentFraction).toBe(0)
    expect(contain.transparentFraction).toBe(0)

    // The image is 4:1 and the frame is ~2:3, so `contain` shrinks it until its
    // width matches and letterboxes the *top and bottom* with the matte colour,
    // while `cover` grows it until the width is full and crops top and bottom.
    // Both samples are in the cut-out, so they read the background, not the photo.
    expect(contain.samples.bottomLeft).not.toEqual(cover.samples.bottomLeft)
    expect(contain.samples.topLeft).not.toEqual(cover.samples.topLeft)
    // And `contain` shows the matte colour at *both* ends, `cover` at neither.
    expect(contain.samples.topLeft[1]).toBeGreaterThan(200)
    // `contain` shows the matte colour (#00ff00) where the image does not reach.
    expect(contain.samples.bottomLeft[1]).toBeGreaterThan(200)
    expect(contain.samples.bottomLeft[0]).toBeLessThan(80)
    // `cover` fills the frame, so the edge is the image and not the matte.
    expect(cover.samples.bottomLeft[1]).toBeLessThan(200)
    // Blur has to change the pixels or the dial is a no-op.
    expect(blurred.samples.topLeft).not.toEqual(cover.samples.topLeft)
  })

  test('D3-F20: a background is refused out loud when there is no matte to show it through', async ({
    page,
  }) => {
    const reasons = await page.evaluate(async () => {
      const base = document.baseURI
      const mod = await import(/* @vite-ignore */ new URL('src/render/background.ts', base).href)
      const gradient = { from: '#fff', to: '#000', angle: 0 }
      const bare = {
        mode: 'none',
        color: '#ffffff',
        gradient,
        imageAssetId: null,
        fit: 'cover',
        blur: 0,
        removed: false,
      }
      const colour = { ...bare, mode: 'color' as const, color: '#123456' }
      return {
        noneBlocked: mod.backgroundBlockedReason(bare),
        colourBlocked: mod.backgroundBlockedReason(colour),
        colourComposites: mod.backgroundComposites(colour),
        noneComposites: mod.backgroundComposites(bare),
        withMatteComposites: mod.backgroundComposites({ ...colour, removed: true }),
        withMatteBlocked: mod.backgroundBlockedReason({ ...colour, removed: true }),
      }
    })
    // Nothing composites behind a subject that has not been cut out, so every
    // background choice is a silent no-op until there is a matte.
    expect(reasons.noneComposites).toBe(false)
    expect(reasons.colourComposites).toBe(false)
    expect(reasons.withMatteComposites).toBe(true)
    expect(reasons.colourBlocked).toBeTruthy()
    // "matte" is the compositing term `src/lib/copy.ts` bans from anything a user
    // reads, and this string is one they read: it names the control that fixes
    // the situation instead, so the panel can say what to do about it.
    expect(reasons.colourBlocked).toMatch(/remove background/i)
    expect(reasons.colourBlocked).not.toMatch(/matte/i)
    expect(reasons.withMatteBlocked).toBeNull()

    // And the panel says so, rather than shipping a control that does nothing.
    //
    // This has to *set up* the refusal before it can look for it. The assertion
    // used to be `toContainText(/matte/i)` on an untouched panel, which was
    // matching the word "matte" in a sentence about the repair brush rather than
    // the refusal the comment above it describes — the document's background was
    // `none`, and `backgroundBlockedReason` returns `null` for `none`, so the
    // panel was showing no refusal at all and the assertion was passing on the
    // wrong word. It only fails now because the repair-brush sentence stopped
    // using the jargon, which is the surface symptom of an assertion that was
    // never about the thing it was named for.
    //
    // So: pick a background, which is the state the refusal is about, and then
    // assert the reason is on screen and names what to do about it.
    await page.getByRole('button', { name: 'Background', exact: true }).click()
    await page.getByRole('button', { name: 'Colour', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(/use remove background first/i)
    // The reason is surfaced at all, which is the point: the same sentence the
    // unit assertion above reads out of `backgroundBlockedReason` is on screen
    // where a user can act on it — by pressing the button it names.
    await expect(dialog).toContainText(/nothing has been removed from the background yet/i)
    await expect(dialog).not.toContainText(/matte/i)
  })
})
