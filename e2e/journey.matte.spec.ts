import { test, expect } from './fixtures'
import { assetAlphaStats, installMatte } from './store'

/**
 * D7-F04 / D7-F05 — the subject matte: where the pixels live, and whether undo
 * puts the old ones back.
 *
 * `@imgly/background-removal` fetches ~42 MB of weights from a CDN on first use,
 * so the *run* cannot be part of a suite. What the claims are about is what
 * `handleRemove` does with the bitmap it gets back: an AssetStore entry that the
 * document references by id, and one undo step. `installMatte` reproduces that
 * commit half exactly — same store, same actions, same interaction grouping — and
 * everything below is then measured on the real bitmap.
 *
 * The pixels are measured in the AssetStore rather than in an export, because the
 * GL background shader does not currently compile for an alpha-bearing source
 * (`src/gl/shaders/index.ts:566` assigns a `vec4` into a `vec3` accumulator), so
 * encoding any matte document throws. The bitmap read here is the one the export
 * would have read. The honesty half of D7-F09 — the panel saying where the model
 * comes from before anything is downloaded — is in `journey.background.spec.ts`.
 */

test.describe('subject matte', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('D7-F04: the matte lives in the asset store, and the document holds only its id', async ({
    page,
    readDoc,
    settle,
  }) => {
    const original = (await readDoc()).source!.assetId
    const matte = await installMatte(page, 0.6)
    await settle()
    expect(matte).not.toBe(original)

    const doc = await readDoc()
    expect(doc.background.removed).toBe(true)
    expect(doc.source!.assetId).toBe(matte)
    // The law in AGENTS.md, on a document that has actually been through a
    // matte: a `Doc` is JSON-serializable, so the pixels cannot be in it.
    const serialised = JSON.stringify(doc)
    expect(serialised).not.toContain('data:')
    expect(serialised).not.toContain('ImageBitmap')
    expect(serialised).not.toContain('OffscreenCanvas')
    expect(doc.source!.assetId).toMatch(/^asset_/)
  })

  test('D7-F04: the stored matte really is transparent where the subject is not', async ({
    page,
    readDoc,
    settle,
  }) => {
    const original = (await readDoc()).source!.assetId
    const before = await assetAlphaStats(page, original)
    // The imported photo is opaque everywhere, so the matte is the only thing
    // that can make any of it transparent.
    expect(before.transparentFraction).toBe(0)

    const matte = await installMatte(page, 0.6)
    await settle()
    const after = await assetAlphaStats(page, matte)
    expect(after.total).toBe(before.total)
    // The bottom 40% of the frame is cut away, and nothing else is.
    expect(after.transparentFraction).toBeGreaterThan(0.3)
    expect(after.transparentFraction).toBeLessThan(0.5)
    expect((await readDoc()).source!.assetId).toBe(matte)
  })

  test('D7-F05: one undo puts the original opaque pixels back', async ({
    page,
    readDoc,
    settle,
  }) => {
    const original = (await readDoc()).source!.assetId
    const matte = await installMatte(page, 0.6)
    await settle()
    const cut = await assetAlphaStats(page, matte)
    expect(cut.transparentFraction).toBeGreaterThan(0.3)

    await page.keyboard.press('ControlOrMeta+z')
    await settle()
    const undone = await readDoc()
    // The document points at the original asset again…
    expect(undone.source!.assetId).toBe(original)
    expect(undone.background.removed).toBe(false)
    // …and that asset is still in the store and still opaque, so the undo is a
    // real return rather than a dangling id.
    const restored = await assetAlphaStats(page, original)
    expect(restored.transparentFraction).toBe(0)
  })

  test('D7-F09: nothing is uploaded, and the panel says where the model comes from', async ({
    page,
    openTool,
  }) => {
    // The image is never sent anywhere: nothing in the run path posts a file.
    // What this asserts is the disclosure — the panel names the weight size and
    // says the model comes off the imgly CDN, so "everything runs in your
    // browser" is not read as "nothing is downloaded either".
    const requests: string[] = []
    const listener = (request: { url(): string; method(): string }): void => {
      requests.push(`${request.method()} ${request.url()}`)
    }
    page.on('request', listener)
    try {
      const panel = await openTool('Background')
      await expect(panel.getByText(/imgly CDN on first use/)).toBeVisible()
      await expect(panel.getByText(/about \d+(\.\d+)? (MB|GB)/)).toBeVisible()
      expect(requests.filter((entry) => /imgly|background-removal|matting/.test(entry))).toEqual([])
    } finally {
      page.off('request', listener)
    }
  })
})
