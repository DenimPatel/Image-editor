import { test as base, expect, type Locator, type Download } from '@playwright/test'
import { ONBOARDING_KEY, ONBOARDING_VERSION } from '../src/components/editor/onboardingKeys'
import { MIRROR_KEY } from '../src/lib/persist/mirror'
import type { Doc } from '../src/model/types'

/**
 * D9-F01 — the e2e fixture every later agent reuses.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Every locator is by accessible name or role, never a CSS-module class. A
 *    `styles.foo` selector dies the next time someone renames a class and says
 *    nothing about whether a control is reachable by keyboard or screen reader.
 * 2. The document is read back out of the running app, not out of a fixture.
 *    `readDoc` resolves the app's own module instance, so a journey assertion is
 *    about what the editor really did.
 */

/** The presentation canvas `useRenderLoop` appends; the one DOM element a user sees. */
const CANVAS = 'canvas.ie-canvas-el'

export type ToolName =
  | 'Crop'
  | 'Adjust'
  | 'Looks'
  | 'Retouch'
  | 'Background'
  | 'Text'
  | 'Draw'
  | 'Stickers'
  | 'Redact'
  | 'Frame'
  | 'Layers'
  | 'Passport'
  | 'Export'

/** `BottomSheet` renders `role="dialog"` with the tool title as its label. */
const SHEET_TITLE: Partial<Record<ToolName, string>> = {
  Crop: 'Crop & Straighten',
  Adjust: 'Adjust',
  Background: 'Background',
  Text: 'Text',
  Layers: 'Layers',
  Export: 'Export',
  Passport: 'Passport',
}

type Fixtures = {
  /** Land on a route under the app base and wait for the app shell to mount. */
  goto: (path?: string) => Promise<void>
  /** Load a bundled sample by its visible label, e.g. `Sample 1`. */
  loadSample: (label?: string) => Promise<void>
  /** Open a tool from the tab bar by its accessible name, and wait for its panel. */
  openTool: (name: ToolName) => Promise<Locator>
  /** The open tool's panel, addressed by its dialog label. */
  panel: (name: ToolName) => Locator
  /** The presentation canvas. */
  canvas: () => Locator
  /** Wait for the render loop to have a canvas and no queued repaint. */
  settle: () => Promise<void>
  /** The live `Doc`, read from the running app's store. */
  readDoc: () => Promise<Doc>
  /**
   * The `Doc` as it sits in IndexedDB, waiting for the autosave row to exist.
   * This reads the *stored* value, not the live store, so it can tell a
   * persisted document from an in-memory one.
   */
  persistedDoc: () => Promise<Doc>
  /** Click `action` and resolve with the bytes and name of what it downloaded. */
  downloadFrom: (action: Locator) => Promise<{ bytes: Buffer; name: string }>
  /** True when a real WebGL2 context can be created in this browser. */
  isWebGL2: () => Promise<boolean>
  /**
   * Wipe IndexedDB so one test's saved session cannot leak into the next, and
   * answer the first-run marker so the orientation panel is not sitting over the
   * import screen waiting to intercept the next test's clicks.
   */
  clearStorage: () => Promise<void>
}

/**
 * The URL the page *itself* loaded `docStore.ts` from, or `null`.
 *
 * The plain path is not always the same module. Vite appends `?t=<timestamp>` to
 * any module it has invalidated, and a dev server that has been up while anyone
 * edited a file serves the app's copy from `…/docStore.ts?t=1790795837837` while
 * a bare `…/docStore.ts` is a different URL in the module map — and importing it
 * builds a *second* store. The failure is silent and total: `getState().present`
 * answers with a default document, the `!doc` guard in `readDoc` never fires
 * because a default document is truthy, and every assertion downstream is made
 * against an empty editor while the screenshot beside it shows the real one.
 *
 * So the live URL is read out of the resource list first, and the bare path is
 * only the fallback for a page served without a module graph.
 */
const readDocExpression = (base: string) => `(async () => {
  try {
    const bare = ${JSON.stringify(`${base}src/store/docStore.ts`)}
    const live = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.startsWith(bare))
    const mod = await import(live ?? bare)
    return mod.useDocStore.getState().present
  } catch {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('image-editor', 1)
      open.onerror = () => reject(new Error('cannot open indexeddb'))
      open.onsuccess = () => {
        const store = open.result.transaction('sessions', 'readonly').objectStore('sessions')
        const req = store.get('current')
        req.onsuccess = () => resolve(req.result ? req.result.doc : null)
        req.onerror = () => reject(new Error('cannot read session'))
      }
    })
  }
})()`

/**
 * Read the autosaved `Doc` straight out of IndexedDB, polling in the page until
 * a row exists.
 *
 * The polling has to happen *inside* the page. `page.waitForFunction` given a
 * string expression tests the expression's own value for truthiness, and a
 * pending promise is truthy, so a promise-returning string returns immediately
 * whether or not the write has landed.
 */
const STORED_DOC = `(async () => {
  const deadline = Date.now() + 20000
  for (;;) {
    const row = await new Promise((resolve) => {
      const open = indexedDB.open('image-editor', 1)
      open.onerror = () => resolve(null)
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('sessions')) {
          db.close()
          resolve(null)
          return
        }
        const request = db.transaction('sessions', 'readonly').objectStore('sessions').get('current')
        request.onsuccess = () => {
          const result = request.result
          db.close()
          resolve(result ? result.doc : null)
        }
        request.onerror = () => {
          db.close()
          resolve(null)
        }
      }
    })
    if (row) return row
    if (Date.now() > deadline) return null
    await new Promise((r) => setTimeout(r, 150))
  }
})()`

export const test = base.extend<Fixtures>({
  clearStorage: async ({ page }, use) => {
    await use(async () => {
      // The synchronous document mirror (D2-F11) is a second copy of the last
      // saved session, and `localStorage` outlives a reload *and* a test. Left
      // alone it would offer the previous test's document on this one's import
      // screen, which is a failure that looks exactly like a persistence bug.
      await page.evaluate((key: string) => {
        try {
          localStorage.removeItem(key)
        } catch {
          // Blocked storage is a legitimate state; there is nothing to clear.
        }
      }, MIRROR_KEY)
      // The first-run marker is the same kind of leak, in the other direction.
      // It is `localStorage`, it outlives a reload, and left *set* it would put
      // the orientation panel over the import screen for any test that reaches
      // the page second — so every test that clicks the file picker or a sample
      // tile would fail on an interception that reads as a layout bug. Clearing
      // it would be worse, not better: that makes the panel appear, and the
      // thing `clearStorage` means is "no state carried over", not "no state at
      // all". So it is *answered* here, and the orientation suite answers it in
      // its own setup whenever a genuine first run is the thing under test.
      await page.evaluate(
        ({ key, version }: { key: string; version: number }) => {
          try {
            localStorage.setItem(key, String(version))
          } catch {
            // Blocked storage: the panel will show, and the test says so.
          }
        },
        { key: ONBOARDING_KEY, version: ONBOARDING_VERSION },
      )
      // Drop the autosaved session so one test cannot inherit another's.
      //
      // The difficulty is that *this fixture must never be the thing that
      // creates the database*. `indexedDB.open(name)` on a database that does
      // not exist creates it at version 1 with no object stores; the app's
      // `openDB(name, 1, { upgrade })` then finds the version already correct,
      // never runs `upgrade`, and every `saveSession` afterwards fails on a
      // missing `sessions` store. That failure is silent — no error toast — so
      // it reads as "persistence is flaky" instead of "the test broke the app".
      //
      // So the wait for the app to open the database happens *without* opening
      // it: `indexedDB.databases()` lists without creating where it exists
      // (Chromium), and on engines that do not implement it the editor's
      // `loadSession` mount effect has already run by the time a route has
      // painted, so a short settle is the equivalent. Only then is it safe to
      // open, and the open is never retried — a retry is a create.
      const cleared = await page.evaluate(
        `(async () => {
          const settle = (ms) => new Promise((r) => setTimeout(r, ms))
          if (typeof indexedDB.databases === 'function') {
            const deadline = Date.now() + 10000
            for (;;) {
              const databases = await indexedDB.databases()
              if (databases.some((entry) => entry.name && entry.name.indexOf('image-editor') === 0)) break
              if (Date.now() > deadline) return false
              await settle(100)
            }
          } else {
            await settle(1000)
          }
          return await new Promise((resolve) => {
            const open = indexedDB.open('image-editor')
            open.onerror = () => resolve(false)
            open.onsuccess = () => {
              const db = open.result
              if (!db.objectStoreNames.contains('sessions')) { db.close(); return resolve(false) }
              let transaction
              try { transaction = db.transaction('sessions', 'readwrite') }
              catch (error) { db.close(); return resolve(false) }
              transaction.objectStore('sessions').delete('current')
              transaction.oncomplete = () => { db.close(); resolve(true) }
              transaction.onerror = () => { db.close(); resolve(false) }
              transaction.onabort = () => { db.close(); resolve(false) }
            }
          })
        })()`,
      )
      if (!cleared) {
        // A route that never opens the database (the Hub) legitimately has
        // nothing to clear, and that is not a failure. A route that should have
        // opened it and did not is a real defect, and the two persistence
        // journey tests say so themselves.
        const onEditor = new URL(page.url()).pathname.includes('/editor')
        if (onEditor) {
          throw new Error(
            'clearStorage: the editor never created its IndexedDB stores, so the session row could not be cleared.',
          )
        }
      }
    })
  },

  goto: async ({ page, baseURL }, use) => {
    await use(async (path = '/') => {
      // Answer the first-run marker *before* the app's first paint.
      //
      // A first-run panel is a modal over the import screen, so on a fresh
      // browser profile every test that clicks the file picker or a sample tile
      // fails on an interception that reads as a layout bug rather than as "this
      // test did not know about the panel". `addInitScript` is the only seam
      // that runs before the app boots, so each test starts as a returning
      // visitor and the product behaves for a second run.
      //
      // The opt-out is `sessionStorage`, not `localStorage`, because
      // `localStorage` is the thing under test and `sessionStorage` survives the
      // reload that gets the app back to a first run. A suite that is *about*
      // the first run sets `e2e-first-run: 'off'` there, removes the marker, and
      // reloads; every navigation after that is a genuine first run.
      await page.addInitScript(
        ({ key, version }: { key: string; version: number }) => {
          try {
            if (sessionStorage.getItem('e2e-first-run') === 'off') return
            localStorage.setItem(key, String(version))
          } catch {
            // Blocked storage: the orientation will show, and the test says so.
          }
        },
        { key: ONBOARDING_KEY, version: ONBOARDING_VERSION },
      )
      // The app is served under a `base`, so `page.goto('/editor')` would
      // resolve to the site root and 404. Join by hand rather than leaning on
      // Playwright's baseURL resolution, which treats a leading slash as
      // absolute.
      const root = baseURL ?? '/'
      await page.goto(new URL(path.replace(/^\//, ''), root).href)
      await expect(page.locator('#root')).not.toBeEmpty()
    })
  },

  loadSample: async ({ page }, use) => {
    await use(async (label = 'Sample 1') => {
      // The sample button's accessible name is the `img` alt plus the visible
      // caption, so it reads "Sample 1 Sample 1"; a prefix match is stable
      // against either half and cannot collide with Sample 2/3.
      const button = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}\\b`) })
      await expect(button).toBeVisible()
      await button.click()
      // The import screen is replaced by the editor once the decode lands.
      await expect(page.locator(CANVAS)).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Editor tools' })).toBeVisible()
    })
  },

  openTool: async ({ page }, use) => {
    await use(async (name: ToolName) => {
      const tab = page
        .getByRole('navigation', { name: 'Editor tools' })
        .getByRole('button', { name, exact: true })
      // Clicking the already-open tab is a no-op by design: a tab opens a tool,
      // it is not a toggle. The click is unconditional so a journey that opens
      // Export to change the format and again to hit Download is doing what a
      // user does, and the marker is asserted afterwards either way.
      await tab.click()
      // `true`, not `page`: a tool tab opens a panel, it does not navigate.
      await expect(tab).toHaveAttribute('aria-current', 'true')
      const title = SHEET_TITLE[name]
      if (title) await expect(page.getByRole('dialog', { name: title })).toBeVisible()
      return page.getByRole('dialog')
    })
  },

  panel: async ({ page }, use) => {
    await use((name: ToolName) => {
      const title = SHEET_TITLE[name]
      return title
        ? page.getByRole('dialog', { name: title })
        : page.getByRole('dialog').filter({ has: page.locator('[class*="sheetBody"]') })
    })
  },

  canvas: async ({ page }, use) => {
    await use(() => page.locator(CANVAS))
  },

  settle: async ({ page }, use) => {
    await use(async () => {
      await expect(page.locator(CANVAS)).toBeVisible()
      // Two back-to-back rAFs with nothing queued behind them means the render
      // loop has already painted the current revision.
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )
    })
  },

  readDoc: async ({ page }, use) => {
    await use(async () => {
      const doc: Doc | null = await page.evaluate(readDocExpression(appBase(page)))
      if (!doc) throw new Error('the editor has no document yet')
      // A second store instance answers with a *default* document, which is
      // truthy and therefore slips past the guard above. Anything that reached
      // this point has a canvas on screen, so a document with no source is not a
      // document at all — it is the wrong module. Say so instead of asserting
      // against it for the rest of the test.
      if (!doc.source) {
        throw new Error(
          'readDoc reached a store with no source image: the page is running a different docStore module than the one readDoc imported',
        )
      }
      return doc as Doc
    })
  },

  persistedDoc: async ({ page }, use) => {
    await use(async () => {
      // The row can predate the edit under test (the autosave is debounced by
      // AUTOSAVE_DEBOUNCE_MS and rewrites the whole session), so callers poll
      // the returned value with `expect.poll` rather than reading it once.
      const doc = await page.evaluate(STORED_DOC)
      if (!doc) throw new Error('no document was autosaved to IndexedDB within 20s')
      return doc as Doc
    })
  },

  downloadFrom: async ({ page }, use) => {
    await use(async (action: Locator) => {
      const [download] = await Promise.all([page.waitForEvent('download'), action.click()])
      return { bytes: await readAll(download), name: download.suggestedFilename() }
    })
  },

  isWebGL2: async ({ page }, use) => {
    await use(() =>
      page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null),
    )
  },
})

/** `/Image-editor/` for the default `base`; the path up to and including the slash. */
function appBase(page: { url: () => string }): string {
  const path = new URL(page.url()).pathname
  return path.slice(0, path.lastIndexOf('/') + 1)
}

/**
 * Read the bytes straight off the download stream. `download.path()` is only
 * guaranteed to be populated once the test has finished, so asserting on it
 * inside the test would silently pass on a missing file.
 */
async function readAll(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('the download produced no readable stream')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export { expect }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Decoded dimensions + container format, read out of real encoded bytes. */
export type ImageHeader = { format: string; width: number; height: number }

/**
 * Read dimensions out of the bytes a download produced. This is the point of
 * the export assertions: "not empty" is not evidence that anything was encoded,
 * and a `.jpg` full of PNG bytes is a silent regression a `toBeTruthy()` waves
 * through.
 */
export function readImageHeader(bytes: Buffer): ImageHeader {
  if (isPng(bytes)) {
    return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (isJpeg(bytes)) return jpegSize(bytes)
  if (isGif(bytes)) {
    return { format: 'gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  }
  if (isWebp(bytes)) return webpSize(bytes)
  if (isAvif(bytes)) return { format: 'avif', width: 0, height: 0 }
  throw new Error(`unrecognised image header: ${bytes.subarray(0, 12).toString('hex')}`)
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length > 24 &&
    bytes.readUInt32BE(0) === 0x89504e47 &&
    bytes.subarray(12, 16).toString('ascii') === 'IHDR'
  )
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function isGif(bytes: Buffer): boolean {
  const tag = bytes.subarray(0, 6).toString('ascii')
  return tag === 'GIF87a' || tag === 'GIF89a'
}

function isWebp(bytes: Buffer): boolean {
  return (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
}

function isAvif(bytes: Buffer): boolean {
  return (
    bytes.subarray(4, 8).toString('ascii') === 'ftyp' &&
    bytes.subarray(8, 12).toString('ascii').startsWith('avif')
  )
}

function jpegSize(bytes: Buffer): ImageHeader {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    // SOF0..SOF15 except the DHT/JPG/DAC markers: those carry the frame size.
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isSof) {
      return {
        format: 'jpeg',
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      }
    }
    offset += 2 + bytes.readUInt16BE(offset + 2)
  }
  throw new Error('the JPEG has no SOF frame header')
}

function webpSize(bytes: Buffer): ImageHeader {
  const chunk = bytes.subarray(12, 16).toString('ascii')
  if (chunk === 'VP8X') {
    return {
      format: 'webp',
      width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
      height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
    }
  }
  if (chunk === 'VP8 ') {
    return {
      format: 'webp',
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    }
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21)
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  throw new Error(`unrecognised WebP chunk: ${chunk}`)
}

/** Mean absolute per-channel difference between two RGB/RGBA buffers, in 0..255 units. */
export function meanAbsDiff(a: Buffer, b: Buffer, channels = 4): number {
  const count = Math.floor(Math.min(a.length, b.length) / channels)
  if (count === 0) return Number.POSITIVE_INFINITY
  let total = 0
  for (let i = 0; i < count; i += 1) {
    const base = i * channels
    total += Math.abs(a[base] - b[base])
    total += Math.abs(a[base + 1] - b[base + 1])
    total += Math.abs(a[base + 2] - b[base + 2])
  }
  return total / (count * 3)
}
