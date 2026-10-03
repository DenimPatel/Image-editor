import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared scene helpers for the byte-level specs.
 *
 * Both are about making a measurement possible rather than about the app: a flat
 * black plate turns "where did the mark land?" into a bounding-box lookup, and a
 * real colour event is the only way a CSS-module colour input reports a change
 * to React.
 */

type OpenTool = (name: 'Stickers' | 'Text' | 'Layers' | 'Export') => Promise<Locator>

/**
 * Cover the frame with an opaque black rectangle, so the only lit pixels in an
 * export are the ones a test put there. The bounding box of those pixels is then
 * a measurement rather than an eyeball.
 */
export async function blackPlate(
  page: Page,
  openTool: OpenTool,
  settle: () => Promise<void>,
  width: number,
): Promise<{ width: number; height: number }> {
  const stickers = await openTool('Stickers')
  await stickers
    .getByRole('group', { name: 'Shapes' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click()
  await settle()
  for (const [label, value] of [
    ['Width', '100'],
    ['Height', '100'],
  ] as const) {
    await stickers.getByRole('slider', { name: label }).fill(value)
  }
  await setColor(stickers.getByLabel('Fill'), '#000000')
  await settle()
  // The plate is the only layer, so the frame is whatever the source aspect says.
  const size = await page.evaluate(async () => {
    const fromApp = (p: string) => new URL(p, new URL(document.baseURI, location.href)).href
    const store = await import(fromApp('src/store/docStore.ts'))
    const source = store.useDocStore.getState().present.source
    return { width: source?.width ?? 0, height: source?.height ?? 0 }
  })
  return { width, height: Math.max(1, Math.round((width * size.height) / Math.max(1, size.width))) }
}

/**
 * Set a `<input type="color">` the way React hears about it.
 *
 * `fill()` sets the value but an `input[type=color]` only reports through the
 * `input` event, and a native setter is needed or React's own value tracker
 * swallows the change and the document never learns about it.
 */
export async function setColor(input: Locator, value: string): Promise<void> {
  await input.evaluate((element, next) => {
    const field = element as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, next)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

/**
 * Write a real PNG of `size` square to `path`, generated rather than pasted in,
 * so a sticker-upload test cannot fail on a corrupt fixture.
 */
export async function writePng(page: Page, path: string, size: number): Promise<void> {
  const base64 = await page.evaluate(async (side) => {
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    // A red square with a white diagonal: not a flat colour, so a sticker that
    // is not really drawn cannot pass a "did anything change" check.
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, side, side)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(2, side / 8)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(side, side)
    ctx.moveTo(side, 0)
    ctx.lineTo(0, side)
    ctx.stroke()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('toBlob produced nothing')
    const buffer = new Uint8Array(await blob.arrayBuffer())
    let text = ''
    for (const byte of buffer) text += String.fromCharCode(byte)
    return btoa(text)
  }, size)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path, Buffer.from(base64, 'base64'))
}

/**
 * Drag one layer row onto another with real HTML5 drag events.
 *
 * The rows are `draggable` divs, so a Playwright mouse drag never starts a
 * native drag; this dispatches the same `dragstart` / `dragover` / `drop`
 * sequence with one shared `DataTransfer`, which is what the panel listens to.
 */
export async function dragRowOnto(page: Page, fromText: RegExp, toText: RegExp): Promise<void> {
  await page.evaluate(
    ({ from, to }) => {
      const rows = Array.from(document.querySelectorAll('[draggable="true"]'))
      const source = rows.find((row) => (row.textContent ?? '').match(from))
      const target = rows.find((row) => (row.textContent ?? '').match(to))
      if (!source || !target) throw new Error(`no rows for ${from} -> ${to}`)
      const transfer = new DataTransfer()
      const fire = (node: Element, type: string): void => {
        // `DragEvent`'s constructor takes no `dataTransfer`, and the property is
        // read-only, so it has to be defined rather than assigned.
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: transfer })
        node.dispatchEvent(event)
      }
      fire(source, 'dragstart')
      fire(target, 'dragover')
      fire(target, 'drop')
      fire(source, 'dragend')
    },
    { from: fromText.source, to: toText.source },
  )
}

/**
 * Wait for the export panel's size estimate to settle.
 *
 * The panel re-renders the *whole* image to a canvas 350 ms after any output
 * field changes, and the Download button is not gated on that render. Clicking
 * Download while the estimate is still in flight races two full-resolution
 * encodes, so every byte-level spec waits for the estimate first — which is also
 * what a person does, since the estimate is the number they are about to trust.
 */
export async function waitForEstimate(panel: Locator): Promise<void> {
  await expect(panel.getByText(/^Output: \d+ × \d+ px · \d+ DPI · ~\d/)).toBeVisible({
    timeout: 60_000,
  })
}
