import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { createDoc } from '../../model/defaults'
import type { Doc, Size } from '../../model/types'
import { createFakeCanvas } from './fakeCanvas'

const rendered: { size: Size; doc: Doc }[] = []

vi.mock('../../render/exportCanvas', () => ({
  renderExportCanvas: async (_source: unknown, doc: Doc, size?: Size) => {
    rendered.push({ size: size ?? { width: doc.geometry.crop.width, height: 1 }, doc })
    return createFakeCanvas(size?.width ?? 100, size?.height ?? 100)
  },
}))

const { buildMultiSizeZip, multiSizeEntryName, normalizeWidths, sanitizeEntryStem } =
  await import('./multiSize')

function docWith(name: string | null): Doc {
  const doc = createDoc()
  return {
    ...doc,
    source:
      name === null
        ? null
        : { assetId: 'asset_1', width: 4000, height: 3000, name, mime: 'image/jpeg' },
  }
}

beforeEach(() => {
  rendered.length = 0
})

describe('sanitizeEntryStem (D7-F15)', () => {
  it('flattens a nested path to a single archive component', () => {
    expect(sanitizeEntryStem('../../etc/passwd')).toBe('passwd')
    expect(sanitizeEntryStem('holiday/2024/trip.jpg')).toBe('trip')
    expect(sanitizeEntryStem('C:\\Users\\me\\photo.png')).toBe('photo')
  })

  it('refuses to produce a dot-segment entry name', () => {
    expect(sanitizeEntryStem('..')).toBe('image')
    expect(sanitizeEntryStem('.hidden')).toBe('hidden')
    expect(sanitizeEntryStem('../../')).toBe('image')
  })

  it('replaces characters that break a zip entry and keeps a fallback', () => {
    expect(sanitizeEntryStem('a:b*c?.jpg')).toBe('a_b_c_')
    expect(sanitizeEntryStem('   ')).toBe('image')
    expect(sanitizeEntryStem('')).toBe('image')
  })

  it('caps the length so a long name cannot blow up the archive', () => {
    expect(sanitizeEntryStem(`${'n'.repeat(200)}.jpg`).length).toBe(60)
  })
})

describe('normalizeWidths', () => {
  it('drops duplicates and invalid values, and sorts ascending', () => {
    expect(normalizeWidths([1920, 720, 1920, 0, -3, 1080.4])).toEqual([720, 1080, 1920])
  })
})

describe('multiSizeEntryName', () => {
  it('records the actual size when a width was clamped', () => {
    expect(multiSizeEntryName('trip', 1920, { width: 1920, height: 1200 }, 'jpeg')).toBe(
      'trip-1920px.jpg',
    )
    expect(multiSizeEntryName('trip', 1920, { width: 800, height: 600 }, 'jpeg')).toBe(
      'trip-1920px-800x600.jpg',
    )
  })
})

describe('buildMultiSizeZip', () => {
  it('renders one entry per width and names them safely', async () => {
    const result = await buildMultiSizeZip(
      { width: 4000, height: 3000 } as unknown as ImageBitmap,
      docWith('../evil/../name.jpg'),
      [1920, 720, 1920],
    )

    expect(result.entries.map((entry) => entry.name)).toEqual(['name-720px.jpg', 'name-1920px.jpg'])
    expect(rendered.map((call) => call.size.width)).toEqual([720, 1920])
  })

  it('keeps the source aspect ratio for every width', async () => {
    await buildMultiSizeZip(
      { width: 4000, height: 3000 } as unknown as ImageBitmap,
      docWith('a.jpg'),
      [1000, 500],
    )
    expect(rendered.map((call) => call.size)).toEqual([
      { width: 500, height: 375 },
      { width: 1000, height: 750 },
    ])
  })

  it('produces a real zip whose entries are the encoded files', async () => {
    const result = await buildMultiSizeZip(
      { width: 400, height: 300 } as unknown as ImageBitmap,
      docWith('shot.jpg'),
      [200, 100],
    )
    expect(result.blob.type).toBe('application/zip')

    const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()))
    expect(Object.keys(archive).sort()).toEqual(['shot-100px.jpg', 'shot-200px.jpg'])
    for (const bytes of Object.values(archive)) {
      // Every entry is a real JPEG: SOI … EOI.
      expect(bytes[0]).toBe(0xff)
      expect(bytes[1]).toBe(0xd8)
      expect(bytes[bytes.length - 2]).toBe(0xff)
      expect(bytes[bytes.length - 1]).toBe(0xd9)
    }
  })

  it('never produces two entries with the same name', async () => {
    const result = await buildMultiSizeZip(
      { width: 400, height: 300 } as unknown as ImageBitmap,
      docWith('a.jpg'),
      [100, 100, 100],
    )
    expect(result.entries).toHaveLength(1)
  })

  it('reports progress that ends at 1 and can be cancelled', async () => {
    const seen: number[] = []
    await buildMultiSizeZip(
      { width: 400, height: 300 } as unknown as ImageBitmap,
      docWith('a.jpg'),
      [200, 400],
      { onProgress: (value) => seen.push(value) },
    )
    expect(seen[seen.length - 1]).toBe(1)
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])

    const controller = new AbortController()
    controller.abort()
    await expect(
      buildMultiSizeZip(
        { width: 400, height: 300 } as unknown as ImageBitmap,
        docWith('a.jpg'),
        [200],
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses an empty width list instead of shipping an empty archive', async () => {
    await expect(
      buildMultiSizeZip(
        { width: 400, height: 300 } as unknown as ImageBitmap,
        docWith('a.jpg'),
        [],
      ),
    ).rejects.toThrow(/No widths selected/)
  })

  it('falls back to a safe stem when the document has no source name', async () => {
    const result = await buildMultiSizeZip(
      { width: 400, height: 300 } as unknown as ImageBitmap,
      docWith(null),
      [200],
    )
    expect(result.entries[0].name).toBe('image-200px.jpg')
  })
})
