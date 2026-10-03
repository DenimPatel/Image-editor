import { describe, expect, it, vi, beforeEach } from 'vitest'
import { planSheet, sheetSizeMm } from './sheet'
import { encodeSheetPhoto, exportPassportSheetPdf, sheetPreviewCount } from './sheetExport'
import { getSpec } from './specs'

const calls = vi.hoisted(() => ({
  options: null as unknown,
  images: [] as unknown[][],
  outputs: [] as string[],
  fill: null as string | null,
  draws: 0,
  encoded: [] as Array<[string, number | undefined]>,
}))

vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor(options: unknown) {
      calls.options = options
    }
    addImage(...args: unknown[]) {
      calls.images.push(args)
    }
    output(type: string) {
      calls.outputs.push(type)
      return new Blob(['pdf'], { type: 'application/pdf' })
    }
  },
}))

const UK = getSpec('uk-35x45')
if (!UK) throw new Error('missing uk-35x45')

/** A canvas stand-in that records how the export canvas was flattened. */
function fakePhotoCanvas(width = 600, height = 800) {
  const canvas = {
    width,
    height,
    getContext: () => ({
      set fillStyle(value: string) {
        calls.fill = value
      },
      get fillStyle() {
        return calls.fill ?? '#000000'
      },
      fillRect: () => undefined,
      drawImage: () => {
        calls.draws += 1
      },
    }),
    toDataURL: (mime: string, quality?: number) => {
      calls.encoded.push([mime, quality])
      return `data:${mime};base64,AAA`
    },
  }
  return canvas as unknown as HTMLCanvasElement
}

beforeEach(() => {
  calls.images = []
  calls.outputs = []
  calls.fill = null
  calls.draws = 0
  calls.encoded = []
})

describe('exportPassportSheetPdf', () => {
  it('builds a page at the sheet size in millimetres', async () => {
    await exportPassportSheetPdf(UK, '4x6', 6, fakePhotoCanvas(), {
      flattenCanvas: fakePhotoCanvas(),
    })

    expect(calls.options).toEqual({
      unit: 'mm',
      format: [101.6, 152.4],
      orientation: 'portrait',
    })
    expect(calls.outputs).toEqual(['blob'])
  })

  it('transposes the page for a landscape sheet', async () => {
    await exportPassportSheetPdf(UK, '4x6', 4, fakePhotoCanvas(), {
      landscape: true,
      flattenCanvas: fakePhotoCanvas(),
    })

    expect(calls.options).toMatchObject({
      format: [152.4, 101.6],
      orientation: 'landscape',
    })
  })

  it('places one image per planned copy, in millimetres', async () => {
    const layout = planSheet(UK, '4x6', 4, UK.dpi)

    await exportPassportSheetPdf(UK, '4x6', 4, fakePhotoCanvas(), {
      flattenCanvas: fakePhotoCanvas(),
    })

    expect(calls.images).toHaveLength(layout.count)
    const pxToMm = 25.4 / layout.dpi
    calls.images.forEach((image, index) => {
      const photo = layout.photos[index]
      expect(image[0]).toBe('data:image/jpeg;base64,AAA')
      expect(image[1]).toBe('JPEG')
      expect(image[2]).toBeCloseTo(photo.x * pxToMm, 6)
      expect(image[3]).toBeCloseTo(photo.y * pxToMm, 6)
      expect(image[4]).toBeCloseTo(photo.width * pxToMm, 6)
      expect(image[5]).toBeCloseTo(photo.height * pxToMm, 6)
    })
  })

  it('places the block at the millimetre position the layout chose', async () => {
    await exportPassportSheetPdf(UK, '4x6', 1, fakePhotoCanvas(), {
      flattenCanvas: fakePhotoCanvas(),
    })

    const page = sheetSizeMm('4x6')
    const photoMm = UK.heightMm
    const [, , x, y, , height] = calls.images[0] as number[]

    expect(y).toBeCloseTo((page.heightMm - photoMm) / 2, 6)
    expect(y + height).toBeCloseTo((page.heightMm + photoMm) / 2, 6)
    expect(x).toBeGreaterThan(0)
  })

  it('honours the document output format instead of always writing JPEG', async () => {
    await exportPassportSheetPdf(UK, '4x6', 1, fakePhotoCanvas(), {
      format: 'png',
      flattenCanvas: fakePhotoCanvas(),
    })

    expect(calls.images[0][1]).toBe('PNG')
    expect(calls.encoded[0][0]).toBe('image/png')
  })
})

describe('encodeSheetPhoto', () => {
  it('flattens a transparent export onto the matte rather than printing black', () => {
    const url = encodeSheetPhoto(fakePhotoCanvas(), {
      matte: '#f2f2f2',
      flattenCanvas: fakePhotoCanvas(),
    })

    expect(calls.fill).toBe('#f2f2f2')
    expect(calls.draws).toBe(1)
    expect(url).toBe('data:image/jpeg;base64,AAA')
  })

  it('defaults the matte to white', () => {
    encodeSheetPhoto(fakePhotoCanvas(), { flattenCanvas: fakePhotoCanvas() })
    expect(calls.fill).toBe('#ffffff')
  })

  it('uses the document quality, not a hard-coded 0.95', () => {
    encodeSheetPhoto(fakePhotoCanvas(), { quality: 0.6, flattenCanvas: fakePhotoCanvas() })
    expect(calls.encoded[0]).toEqual(['image/jpeg', 0.6])
  })

  it('clamps a quality outside 0..1', () => {
    encodeSheetPhoto(fakePhotoCanvas(), { quality: 4, flattenCanvas: fakePhotoCanvas() })
    expect(calls.encoded[0][1]).toBe(1)
    encodeSheetPhoto(fakePhotoCanvas(), { quality: -2, flattenCanvas: fakePhotoCanvas() })
    expect(calls.encoded[1][1]).toBe(0.01)
  })

  it('sizes the flattened canvas to the export, not to the sheet cell', () => {
    const flatten = fakePhotoCanvas()
    flatten.width = 0
    flatten.height = 0
    encodeSheetPhoto(fakePhotoCanvas(413, 531), { flattenCanvas: flatten })

    expect(flatten.width).toBe(413)
    expect(flatten.height).toBe(531)
  })
})

describe('sheetPreviewCount', () => {
  it('counts the copies a sheet actually holds', () => {
    expect(sheetPreviewCount(UK, '4x6', 99)).toBe(6)
    expect(sheetPreviewCount(UK, '4x6', 4)).toBe(4)
  })
})
