import type { Page } from '@playwright/test'
import type { Doc, Layer, LayerTransform, TextLayer } from '../src/model/types'

/**
 * A typed seam onto the running app's own store, for the cases a UI journey
 * cannot reach.
 *
 * `e2e/fixtures.ts` already reads the store this way: the Vite dev server serves
 * `src/store/docStore.ts` under exactly the URL the app imported, so a dynamic
 * `import()` in page context resolves to the *same* module instance and therefore
 * the same zustand store. These helpers go through the app's own `actions.ts`
 * rather than poking `setState`, so history and autosave behave as they do for a
 * user — the document really is edited, not spoofed.
 *
 * The specifier is built at runtime and passed through a variable, so the
 * TypeScript compiler does not try to resolve a browser URL as a path on disk.
 */

/**
 * Patch the first layer of `kind` through `updateLayerPatch`.
 *
 * This exists for controls the panels do not expose — a watermark's transform, a
 * redaction's opacity in a document that already carries one. The *rendering* is
 * still measured on exported bytes; only the setup is scripted.
 */
export async function patchFirstLayer(
  page: Page,
  kind: Layer['kind'],
  patch: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    async ({ kind, patch }) => {
      const base = document.baseURI
      const store = (await import(
        /* @vite-ignore */ new URL('src/store/docStore.ts', base).href
      )) as typeof import('../src/store/docStore')
      const actions = (await import(
        /* @vite-ignore */ new URL('src/store/actions.ts', base).href
      )) as typeof import('../src/store/actions')
      const layer = store.useDocStore.getState().present.layers.find((l) => l.kind === kind)
      if (!layer) throw new Error(`the document has no ${kind} layer to patch`)
      actions.updateLayerPatch(layer.id, patch)
    },
    { kind, patch },
  )
}

/**
 * Move / scale / rotate / fade / blend a layer of `kind`.
 *
 * `index` picks among layers of the same kind, which matters as soon as a scene
 * has more than one — a black plate under the shape being inspected, say.
 */
export async function transformFirstLayer(
  page: Page,
  kind: Layer['kind'],
  transform: Partial<LayerTransform>,
  index = 0,
): Promise<void> {
  await page.evaluate(
    async ({ kind, transform, index }) => {
      const base = document.baseURI
      const store = (await import(
        /* @vite-ignore */ new URL('src/store/docStore.ts', base).href
      )) as typeof import('../src/store/docStore')
      const actions = (await import(
        /* @vite-ignore */ new URL('src/store/actions.ts', base).href
      )) as typeof import('../src/store/actions')
      const layer = store.useDocStore.getState().present.layers.filter((l) => l.kind === kind)[
        index
      ]
      if (!layer) throw new Error(`the document has no ${kind} layer at index ${index}`)
      actions.updateLayerPatch(layer.id, { transform: { ...layer.transform, ...transform } })
    },
    { kind, transform, index },
  )
}

/**
 * Merge a partial into a text layer's style.
 *
 * `updateLayerPatch` replaces the field it is given rather than merging into it,
 * so patching `style` with `{ fontId }` would blank `size`, `color` and `align`
 * and the layer would draw nothing at all. This reads the style first, which is
 * what the inspector does on every keystroke.
 */
export async function patchFirstTextStyle(
  page: Page,
  style: Partial<TextLayer['style']>,
): Promise<void> {
  await page.evaluate(async (style) => {
    const base = document.baseURI
    const store = (await import(
      /* @vite-ignore */ new URL('src/store/docStore.ts', base).href
    )) as typeof import('../src/store/docStore')
    const actions = (await import(
      /* @vite-ignore */ new URL('src/store/actions.ts', base).href
    )) as typeof import('../src/store/actions')
    const layer = store.useDocStore.getState().present.layers.find((l) => l.kind === 'text')
    if (!layer || layer.kind !== 'text') throw new Error('the document has no text layer')
    actions.updateLayerPatch(layer.id, { style: { ...layer.style, ...style } })
  }, style)
}

/**
 * Install a subject matte the way `handleRemove` does, without the model.
 *
 * `BackgroundPanel` calls `removeBackground(source, …)` and then commits exactly
 * this shape: a cut-out bitmap goes into the AssetStore, `doc.source` is
 * repointed at it, and `doc.background.removed` flips. The 42 MB weight download
 * is the only part that needs a CDN, so this reproduces the commit half — the
 * half the claims are about — through the same store, the same actions and the
 * same interaction grouping, and the export is then measured on real bytes.
 *
 * The cut-out is the top 60% of the frame at full alpha and the rest fully
 * transparent, so "the matte reached the file" is a fact about alpha bytes.
 */
export async function installMatte(page: Page, keepFraction = 0.6): Promise<string> {
  return page.evaluate(async (keep) => {
    const base = document.baseURI
    const store = await import(/* @vite-ignore */ new URL('src/store/docStore.ts', base).href)
    const assets = await import(
      /* @vite-ignore */ new URL('src/model/assetsSingleton.ts', base).href
    )
    const current = store.useDocStore.getState().present
    const source = current.source
    if (!source) throw new Error('the document has no source image')
    const sourceAsset = assets.assetStore.get(source.assetId)
    if (!sourceAsset) throw new Error('the source asset is not in the store')

    const width = sourceAsset.width
    const height = sourceAsset.height
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(sourceAsset as CanvasImageSource, 0, 0, width, height)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height * keep)
    ctx.globalCompositeOperation = 'source-over'

    // `Editor.bitmapFor` only accepts a real `ImageBitmap`, so the cut-out has
    // to be one: an OffscreenCanvas in the store is not "renderable" and the
    // editor falls back to the import screen with no error at all.
    const assetId = assets.assetStore.add(await createImageBitmap(canvas))
    store.useDocStore.getState().beginInteraction('background:remove')
    store.useDocStore.getState().update((doc: Doc) => ({
      ...doc,
      source: { ...source, assetId, width, height },
      background: { ...doc.background, removed: true },
    }))
    store.useDocStore.getState().endInteraction()
    return store.useDocStore.getState().present.source?.assetId ?? ''
  }, keepFraction)
}

/**
 * How much of an asset is transparent, measured from the real bitmap.
 *
 * Used instead of an export because the GL background shader currently fails to
 * compile for any alpha-bearing source (see the report), so a document with a
 * matte cannot be encoded at all. The pixels in the AssetStore are still real and
 * still measurable, and that is what the storage and undo claims are about.
 */
export async function assetAlphaStats(
  page: Page,
  assetId: string,
): Promise<{ total: number; transparent: number; transparentFraction: number }> {
  return page.evaluate(async (id) => {
    const base = document.baseURI
    const assets = await import(
      /* @vite-ignore */ new URL('src/model/assetsSingleton.ts', base).href
    )
    const asset = assets.assetStore.get(id)
    if (!asset) throw new Error(`no asset ${id} in the store`)
    const source = asset as unknown as CanvasImageSource
    const width = (asset as unknown as { width: number }).width
    const height = (asset as unknown as { height: number }).height
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d context')
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(source, 0, 0, width, height)
    const { data } = ctx.getImageData(0, 0, width, height)
    let transparent = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] < 8) transparent += 1
    const total = data.length / 4
    return { total, transparent, transparentFraction: transparent / total }
  }, assetId)
}

/** The live document, typed. */
export async function readTypedDoc(page: Page): Promise<Doc> {
  return page.evaluate(async () => {
    const base = document.baseURI
    const store = (await import(
      /* @vite-ignore */ new URL('src/store/docStore.ts', base).href
    )) as typeof import('../src/store/docStore')
    return store.useDocStore.getState().present
  })
}

/**
 * Merge a partial into `doc.output` through the app's own `setOutput`, so the
 * panel state, the document and the autosave row all agree.
 *
 * Only used where the panel control is a spinner (the DPI `Stepper` has no
 * text field, so a value like 600 is not reachable in one click) or to keep a
 * byte-level suite from rendering a 24-megapixel image on every step.
 */
export async function setOutput(page: Page, patch: Partial<Doc['output']>): Promise<void> {
  await page.evaluate(async (patch) => {
    const base = document.baseURI
    const actions = (await import(
      /* @vite-ignore */ new URL('src/store/actions.ts', base).href
    )) as typeof import('../src/store/actions')
    actions.setOutput(patch)
  }, patch)
}
