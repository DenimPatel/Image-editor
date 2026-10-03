import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCanvas } from '../features/export/fakeCanvas'
import {
  asBlobPart,
  canvasToBlob,
  downloadBlob,
  encodeCanvas,
  extensionFor,
  mimeFor,
  OBJECT_URL_REVOKE_DELAY_MS,
  UnsupportedEncodingError,
} from './encode'

describe('canvasToBlob', () => {
  it('returns the blob when the encoder honours the requested type', async () => {
    const canvas = createFakeCanvas(64, 48)
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.8)
    expect(blob.type).toBe('image/jpeg')
    expect(canvas.calls).toEqual([{ mime: 'image/jpeg', quality: 0.8 }])
  })

  it('rejects when the browser silently falls back to another type', async () => {
    // What the HTML spec mandates: an unsupported toBlob type yields PNG.
    const canvas = createFakeCanvas(64, 48, {
      supported: ['image/jpeg', 'image/png'],
      fallbackMime: 'image/png',
    })
    await expect(canvasToBlob(canvas, 'image/avif', 0.8)).rejects.toBeInstanceOf(
      UnsupportedEncodingError,
    )
    await expect(canvasToBlob(canvas, 'image/avif', 0.8)).rejects.toThrow(
      /cannot encode image\/avif/,
    )
  })
})

describe('encodeCanvas type verification', () => {
  it('never hands back PNG bytes for an AVIF request', async () => {
    const canvas = createFakeCanvas(32, 32, {
      supported: ['image/png'],
      fallbackMime: 'image/png',
    })
    await expect(encodeCanvas(canvas, 'avif', 0.9)).rejects.toBeInstanceOf(UnsupportedEncodingError)
  })

  it('rejects when the encoder produces nothing at all', async () => {
    const canvas = createFakeCanvas(16, 16)
    ;(canvas as unknown as { toBlob: unknown }).toBlob = (callback: BlobCallback) =>
      setTimeout(() => callback(null), 0)
    await expect(canvasToBlob(canvas, 'image/png')).rejects.toThrow(/Failed to encode/)
  })
})

describe('encodeCanvas PDF physical size (D7-F11)', () => {
  const pxToMm = (px: number, dpi: number) => (px * 25.4) / dpi

  it('sizes the page in millimetres at the requested dpi, not in 96 dpi pixels', async () => {
    const canvas = createFakeCanvas(4000, 2667)
    const blob = await encodeCanvas(canvas, 'pdf', 0.9, 300)
    expect(blob.type).toBe('application/pdf')

    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()))
    const mediaBox = /MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(text)
    expect(mediaBox).not.toBeNull()

    const [, widthMm, heightMm] = mediaBox as RegExpExecArray
    const widthPt = Number(widthMm)
    const heightPt = Number(heightMm)
    // jsPDF writes the page in points: 1pt = 1/72in, 1in = 25.4mm.
    const actualWidthMm = (widthPt * 25.4) / 72
    const actualHeightMm = (heightPt * 25.4) / 72

    expect(actualWidthMm).toBeCloseTo(pxToMm(4000, 300), 1)
    expect(actualHeightMm).toBeCloseTo(pxToMm(2667, 300), 1)
    // 96 dpi would have produced a 1058 mm page; 300 dpi must be far smaller.
    expect(actualWidthMm).toBeLessThan(pxToMm(4000, 96) / 2)
  })

  it('a different dpi produces a different page for the same pixels', async () => {
    const canvas = createFakeCanvas(1200, 1200)
    const read = async (dpi: number) => {
      const blob = await encodeCanvas(canvas, 'pdf', 0.9, dpi)
      const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()))
      const match = /MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(text)
      return (Number((match as RegExpExecArray)[1]) * 25.4) / 72
    }
    expect(await read(300)).toBeCloseTo(pxToMm(1200, 300), 1)
    expect(await read(600)).toBeCloseTo(pxToMm(1200, 600), 1)
    expect(await read(300)).toBeCloseTo((await read(600)) * 2, 1)
  })

  it('does not build a base64 data URL', async () => {
    const canvas = createFakeCanvas(200, 100)
    // The fake canvas throws from `toDataURL`, so a regression to base64 fails
    // here rather than silently allocating a string twice the size of the file.
    await expect(encodeCanvas(canvas, 'pdf', 0.9, 150)).resolves.toBeInstanceOf(Blob)
  })

  it('embeds the image at the same physical size as the page', async () => {
    const canvas = createFakeCanvas(2480, 3508)
    const blob = await encodeCanvas(canvas, 'pdf', 0.9, 300)
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()))
    // jsPDF writes the placement as `w 0 0 h 0 0 cm` in the content stream.
    const cm = /([\d.]+)\s+0\.?\s+0\.?\s+([\d.]+)\s+0\.?\s+0\.?\s+cm/u.exec(text)
    expect(cm).not.toBeNull()
    const widthMm = (Number((cm as RegExpExecArray)[1]) * 25.4) / 72
    const heightMm = (Number((cm as RegExpExecArray)[2]) * 25.4) / 72
    expect(widthMm).toBeCloseTo(pxToMm(2480, 300), 1)
    expect(heightMm).toBeCloseTo(pxToMm(3508, 300), 1)
  })
})

describe('downloadBlob (D7-F13)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('revokes the object URL only after the click has been handled', () => {
    const revoked: number[] = []
    const originalRevoke = URL.revokeObjectURL
    const originalCreate = URL.createObjectURL
    URL.createObjectURL = () => 'blob:fake'
    URL.revokeObjectURL = () => revoked.push(Date.now())

    try {
      const clicked: string[] = []
      const originalCreateElement = document.createElement.bind(document)
      const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = originalCreateElement(tag) as HTMLAnchorElement
        if (tag === 'a') element.click = () => clicked.push(element.href)
        return element
      })

      downloadBlob(new Blob([new Uint8Array([1, 2, 3])]), 'out.jpg')
      expect(clicked).toEqual(['blob:fake'])
      // Still alive: revoking in the same task cancels the download.
      expect(revoked).toHaveLength(0)
      expect(document.querySelector('a')).toBeNull()

      vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS)
      expect(revoked).toHaveLength(1)
      spy.mockRestore()
    } finally {
      URL.revokeObjectURL = originalRevoke
      URL.createObjectURL = originalCreate
    }
  })
})

describe('format helpers', () => {
  it('maps every format to a matching MIME and extension', () => {
    const pairs: [Parameters<typeof mimeFor>[0], string, string][] = [
      ['jpeg', 'image/jpeg', 'jpg'],
      ['png', 'image/png', 'png'],
      ['webp', 'image/webp', 'webp'],
      ['avif', 'image/avif', 'avif'],
      ['pdf', 'application/pdf', 'pdf'],
    ]
    for (const [format, mime, ext] of pairs) {
      expect(mimeFor(format)).toBe(mime)
      expect(extensionFor(format)).toBe(ext)
    }
  })
})

describe('asBlobPart', () => {
  it('passes the exact bytes through', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250])
    const blob = new Blob([asBlobPart(bytes)])
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
  })
})
