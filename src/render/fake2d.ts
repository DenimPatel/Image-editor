/**
 * A minimal in-memory Canvas2D context for tests.
 *
 * jsdom has no canvas package, so `getContext('2d')` returns null and the
 * Canvas2D backend and the export compositing path cannot be exercised at all
 * without this. It is deliberately small: only the calls the render and export
 * paths actually make, and `drawImage` does a real nearest-neighbour blit so a
 * coordinate mistake shows up as wrong pixels rather than as a silent no-op.
 */
import type { Pixels } from './cpu-passes'

/**
 * A canvas pre-filled with `pixels`, usable as a `TexImageSource`. Writes the
 * backing store directly, so it does not depend on which `getContext` patch is
 * installed when.
 */
export function sourceCanvas(pixels: Pixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  backingOf(canvas).set(pixels.data.subarray(0, canvas.width * canvas.height * 4))
  return canvas
}

export type Fake2d = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D & { calls: string[] }
  restore: () => void
  /** Everything that reached the canvas, top-down, straight alpha. */
  read: () => Uint8ClampedArray
  /**
   * The same, for a specific canvas. The backend decodes the source through a
   * second, off-frame surface, so "the last context created" is not
   * necessarily the one whose output the test wants to read.
   */
  readCanvas: (canvas: HTMLCanvasElement) => Uint8ClampedArray
  /** The captured call log for a specific canvas. */
  callsFor: (canvas: HTMLCanvasElement) => string[]
}

type Blit = { source: HTMLCanvasElement; dx: number; dy: number; dw: number; dh: number }

/** Captured once, at module load, so `restore` always puts the real one back. */
const nativeGetContext = HTMLCanvasElement.prototype.getContext

function backingOf(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const store = canvas as unknown as { __pixels?: Uint8ClampedArray }
  if (!store.__pixels || store.__pixels.length !== canvas.width * canvas.height * 4) {
    store.__pixels = new Uint8ClampedArray(Math.max(1, canvas.width * canvas.height * 4))
  }
  return store.__pixels
}

export function installFake2d(): Fake2d {
  let blits: Blit[] = []
  const created: { canvas: HTMLCanvasElement; ctx: Fake2d['ctx'] }[] = []

  HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, id: string) {
    // Everything except 2D is simply absent: delegating to the previous
    // implementation captures a jsdom brand check across environments, and
    // jsdom has no other context this double is asked about.
    if (id !== '2d') return null
    // The body is written against a named canvas rather than `this`.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const canvas = this
    // Re-read the backing on every call: resizing a canvas replaces the store,
    // and a renderer resizes before it draws.
    const buf = (): Uint8ClampedArray => backingOf(canvas)
    const calls: string[] = []
    const ctx = {
      canvas,
      calls,
      fillStyle: '#000000',
      strokeStyle: '#000000',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      filter: 'none',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low' as ImageSmoothingQuality,
      lineWidth: 1,
      lineCap: 'butt' as CanvasLineCap,
      lineJoin: 'miter' as CanvasLineJoin,
      font: '10px sans-serif',
      textAlign: 'start' as CanvasTextAlign,
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      setTransform: () => calls.push('setTransform'),
      transform: () => calls.push('transform'),
      translate: () => calls.push('translate'),
      scale: () => calls.push('scale'),
      rotate: () => calls.push('rotate'),
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      arc: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      fillText: () => undefined,
      measureText: (text: string) => ({ width: text.length * 6 }) as TextMetrics,
      fillRect: (x: number, y: number, w: number, h: number) => {
        calls.push('fillRect')
        for (let py = y; py < y + h; py += 1) {
          for (let px = x; px < x + w; px += 1) {
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue
            const i = (py * canvas.width + px) * 4
            buf()[i] = 255
            buf()[i + 1] = 255
            buf()[i + 2] = 255
            buf()[i + 3] = 255
          }
        }
      },
      clearRect: (x: number, y: number, w: number, h: number) => {
        calls.push('clearRect')
        for (let py = y; py < y + h; py += 1) {
          for (let px = x; px < x + w; px += 1) {
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue
            const i = (py * canvas.width + px) * 4
            buf()[i] = 0
            buf()[i + 1] = 0
            buf()[i + 2] = 0
            buf()[i + 3] = 0
          }
        }
      },
      drawImage: (source: CanvasImageSource, ...rest: number[]) => {
        calls.push('drawImage')
        const [dx = 0, dy = 0, dw = canvas.width, dh = canvas.height] = rest
        const element = source as unknown as HTMLCanvasElement
        const src = backingOf(element)
        const sw = element.width
        const sh = element.height
        blits.push({ source: element, dx, dy, dw, dh })
        for (let py = 0; py < dh; py += 1) {
          for (let px = 0; px < dw; px += 1) {
            const tx = Math.round(dx + px)
            const ty = Math.round(dy + py)
            if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue
            const sx = Math.min(sw - 1, Math.max(0, Math.round((px / dw) * sw)))
            const sy = Math.min(sh - 1, Math.max(0, Math.round((py / dh) * sh)))
            const si = (sy * sw + sx) * 4
            const ti = (ty * canvas.width + tx) * 4
            buf()[ti] = src[si]!
            buf()[ti + 1] = src[si + 1]!
            buf()[ti + 2] = src[si + 2]!
            buf()[ti + 3] = src[si + 3]!
          }
        }
      },
      createImageData: (w: number, h: number) => {
        calls.push('createImageData')
        return {
          data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
          width: w,
          height: h,
          colorSpace: 'srgb',
        } as ImageData
      },
      getImageData: (x: number, y: number, w: number, h: number) => {
        calls.push('getImageData')
        const out = new Uint8ClampedArray(Math.max(1, w * h * 4))
        for (let py = 0; py < h; py += 1) {
          for (let px = 0; px < w; px += 1) {
            const cx = x + px
            const cy = y + py
            if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) continue
            const si = (cy * canvas.width + cx) * 4
            const ti = (py * w + px) * 4
            out[ti] = buf()[si]!
            out[ti + 1] = buf()[si + 1]!
            out[ti + 2] = buf()[si + 2]!
            out[ti + 3] = buf()[si + 3]!
          }
        }
        return { data: out, width: w, height: h, colorSpace: 'srgb' } as ImageData
      },
      putImageData: (image: ImageData, dx: number, dy: number) => {
        calls.push('putImageData')
        for (let py = 0; py < image.height; py += 1) {
          for (let px = 0; px < image.width; px += 1) {
            const tx = dx + px
            const ty = dy + py
            if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue
            const si = (py * image.width + px) * 4
            const ti = (ty * canvas.width + tx) * 4
            buf()[ti] = image.data[si]!
            buf()[ti + 1] = image.data[si + 1]!
            buf()[ti + 2] = image.data[si + 2]!
            buf()[ti + 3] = image.data[si + 3]!
          }
        }
      },
    }
    const result = ctx as unknown as Fake2d['ctx']
    created.push({ canvas, ctx: result })
    return result
  } as unknown as HTMLCanvasElement['getContext']

  return {
    canvas: document.createElement('canvas'),
    get ctx() {
      const found = created[created.length - 1]
      if (!found) throw new Error('no 2d context was created')
      return found.ctx
    },
    restore: () => {
      HTMLCanvasElement.prototype.getContext = nativeGetContext
      blits = []
    },
    read: () => {
      const last = created[created.length - 1]
      if (!last) throw new Error('no 2d context was created')
      return backingOf(last.canvas)
    },
    readCanvas: (canvas: HTMLCanvasElement) => backingOf(canvas),
    callsFor: (canvas: HTMLCanvasElement) => {
      const found = created.find((entry) => entry.canvas === canvas)
      if (!found) throw new Error('no 2d context was created for that canvas')
      return found.ctx.calls
    },
  } as Fake2d
}
