import { describe, expect, it } from 'vitest'
import { createDoc } from '../../model/defaults'
import type { Doc, ExportFormat, MetadataPolicy } from '../../model/types'
import { readJpegDpi, readOutputDpi, readPngDpi, readWebpDpi } from '../../lib/metadata/dpi'
import { containsExif } from '../../lib/metadata/exif'
import { walkPng } from '../../lib/metadata/png'
import { walkRiff } from '../../lib/metadata/webp'
import { createFakeCanvas } from './fakeCanvas'
import { encodeDocument } from './encodeDocument'

function docFor(format: ExportFormat, overrides: Partial<Doc['output']> = {}): Doc {
  const doc = createDoc()
  return { ...doc, output: { ...doc.output, format, ...overrides } }
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('encodeDocument DPI (D7-F12)', () => {
  it('writes real DPI into JPEG output bytes', async () => {
    const result = await encodeDocument(createFakeCanvas(320, 240), docFor('jpeg', { dpi: 300 }))
    expect(readJpegDpi(await bytesOf(result.blob))).toBe(300)
    expect(result.dpiWritten).toBe(true)
    expect(result.blob.type).toBe('image/jpeg')
  })

  it('writes real DPI into PNG output bytes', async () => {
    const result = await encodeDocument(createFakeCanvas(320, 240), docFor('png', { dpi: 150 }))
    expect(readPngDpi(await bytesOf(result.blob))).toBe(150)
    expect(result.dpiWritten).toBe(true)
  })

  it('writes real DPI into WebP output bytes', async () => {
    const result = await encodeDocument(createFakeCanvas(320, 240), docFor('webp', { dpi: 600 }))
    const bytes = await bytesOf(result.blob)
    expect(readWebpDpi(bytes)).toBe(600)
    expect(readOutputDpi('webp', bytes)).toBe(600)
    expect(result.dpiWritten).toBe(true)
  })

  it('reports honestly that AVIF carries no density field', async () => {
    const result = await encodeDocument(createFakeCanvas(320, 240), docFor('avif', { dpi: 300 }))
    expect(result.dpiWritten).toBe(false)
    expect(result.notes.join(' ')).toMatch(/AVIF files carry no resolution metadata/)
  })

  it('reports the DPI as written for PDF, where the page geometry carries it', async () => {
    const result = await encodeDocument(createFakeCanvas(1200, 800), docFor('pdf', { dpi: 300 }))
    expect(result.dpiWritten).toBe(true)
    expect(result.blob.type).toBe('application/pdf')
  })
})

describe('encodeDocument metadata policy (D7-F01, D7-F08)', () => {
  it('strip removes EXIF, ICC and comments from real JPEG bytes', async () => {
    const canvas = createFakeCanvas(200, 200)
    const raw = await bytesOf(
      (await encodeDocument(canvas, docFor('jpeg', { metadata: 'all' }))).blob,
    )
    // The fake canvas really does emit EXIF and an ICC profile.
    expect(containsExif(raw)).toBe(true)

    const stripped = await bytesOf(
      (await encodeDocument(canvas, docFor('jpeg', { metadata: 'strip' }))).blob,
    )
    expect(containsExif(stripped)).toBe(false)
    // The JFIF density survives, and so does the image data.
    expect(stripped[2]).toBe(0xff)
    expect(stripped[3]).toBe(0xe0)
    expect(stripped.length).toBeLessThan(raw.length)
  })

  it('orientation keeps a minimal orientation tag and drops the ICC profile', async () => {
    const bytes = await bytesOf(
      (
        await encodeDocument(
          createFakeCanvas(200, 200),
          docFor('jpeg', { metadata: 'orientation' }),
        )
      ).blob,
    )
    expect(containsExif(bytes)).toBe(true)
    const types: number[] = []
    for (let i = 2; i + 1 < bytes.length;) {
      if (bytes[i] !== 0xff) break
      const marker = bytes[i + 1]
      types.push(marker)
      if (marker === 0xda) break
      const length = (bytes[i + 2] << 8) | bytes[i + 3]
      if (length < 2) break
      i += 2 + length
    }
    expect(types).toContain(0xe1)
    expect(types).not.toContain(0xe2)
  })

  it('strip removes PNG text and EXIF chunks', async () => {
    const bytes = await bytesOf(
      (await encodeDocument(createFakeCanvas(120, 90), docFor('png', { metadata: 'strip' }))).blob,
    )
    const types = walkPng(bytes).chunks.map((chunk) => chunk.type)
    expect(types).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND'])
  })

  it('orientation keeps a PNG eXIf chunk with only the orientation tag', async () => {
    const bytes = await bytesOf(
      (
        await encodeDocument(
          createFakeCanvas(120, 90),
          docFor('png', { metadata: 'orientation', dpi: 72 }),
        )
      ).blob,
    )
    const types = walkPng(bytes).chunks.map((chunk) => chunk.type)
    expect(types).toEqual(['IHDR', 'pHYs', 'eXIf', 'IDAT', 'IEND'])
    const exif = walkPng(bytes).chunks.find((chunk) => chunk.type === 'eXIf')
    expect(exif).toBeDefined()
    // A 26-byte TIFF block: a single inline SHORT entry, plus the chunk CRC.
    expect((exif?.end ?? 0) - (exif?.dataStart ?? 0)).toBe(30)
  })

  it('strip removes the WebP XMP chunk', async () => {
    const canvas = createFakeCanvas(160, 120)
    const withXmp = await bytesOf(
      (await encodeDocument(canvas, docFor('webp', { metadata: 'all' }))).blob,
    )
    expect(walkRiff(withXmp).chunks.map((chunk) => chunk.type)).toContain('XMP ')

    const stripped = await bytesOf(
      (await encodeDocument(canvas, docFor('webp', { metadata: 'strip' }))).blob,
    )
    expect(walkRiff(stripped).chunks.map((chunk) => chunk.type)).not.toContain('XMP ')
  })
})

describe('encodeDocument target bytes (D7-F14)', () => {
  it('reports metTarget false when even the lowest quality overshoots', async () => {
    const result = await encodeDocument(
      createFakeCanvas(1200, 900),
      docFor('jpeg', { targetBytes: 64 }),
    )
    expect(result.metTarget).toBe(false)
    expect(result.quality).toBeLessThan(0.92)
    expect(result.blob.size).toBeGreaterThan(64)
  })

  it('reports metTarget true when the search lands under the cap', async () => {
    const result = await encodeDocument(
      createFakeCanvas(200, 150),
      docFor('jpeg', { targetBytes: 4 * 1024 * 1024 }),
    )
    expect(result.metTarget).toBe(true)
    expect(result.quality).toBe(0.92)
  })

  it('never promises a size cap for a format that cannot enforce one', async () => {
    const result = await encodeDocument(
      createFakeCanvas(200, 150),
      docFor('png', { targetBytes: 1024 }),
    )
    expect(result.metTarget).toBe(true)
    expect(result.notes.join(' ')).toMatch(/maximum size cannot be enforced for PNG/)
  })
})

describe('encodeDocument progress and cancellation (D7-F16)', () => {
  it('reports monotonic progress that ends at 1', async () => {
    const seen: number[] = []
    await encodeDocument(createFakeCanvas(120, 90), docFor('jpeg', { targetBytes: 4096 }), {
      onProgress: (value) => seen.push(value),
    })
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[0]).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(1)
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
  })

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      encodeDocument(createFakeCanvas(120, 90), docFor('jpeg'), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops as soon as the signal fires mid-search', async () => {
    const controller = new AbortController()
    const canvas = createFakeCanvas(600, 600)
    const original = canvas.toBlob.bind(canvas)
    let encodes = 0
    ;(canvas as unknown as { toBlob: unknown }).toBlob = (
      callback: BlobCallback,
      type?: string,
      quality?: number,
    ) => {
      encodes += 1
      if (encodes > 1) controller.abort()
      original(callback, type, quality)
    }
    await expect(
      encodeDocument(canvas, docFor('jpeg', { targetBytes: 2048 }), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(encodes).toBeLessThan(7)
  })
})

describe('encodeDocument honesty about the encoder', () => {
  it('fails loudly when the browser cannot produce the requested type', async () => {
    const canvas = createFakeCanvas(64, 64, {
      supported: ['image/png'],
      fallbackMime: 'image/png',
    })
    await expect(encodeDocument(canvas, docFor('webp'))).rejects.toThrow(/cannot encode/)
  })

  it('keeps the requested metadata policy for every format', async () => {
    const policies: MetadataPolicy[] = ['strip', 'orientation', 'all']
    for (const policy of policies) {
      const result = await encodeDocument(
        createFakeCanvas(80, 60),
        docFor('jpeg', { metadata: policy, dpi: 200 }),
      )
      expect(result.dpiWritten).toBe(true)
      expect(result.blob.type).toBe('image/jpeg')
    }
  })
})
