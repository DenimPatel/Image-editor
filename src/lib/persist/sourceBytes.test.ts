import { describe, expect, it, vi } from 'vitest'
import { createDoc } from '../../model/defaults'
import type { Doc } from '../../model/types'
import type { SourceBytes } from './session'
import { bytesForSource, REPLACEMENT_MIME } from './sourceBytes'

function docFor(assetId: string): Doc {
  return createDoc({
    source: {
      assetId,
      width: 100,
      height: 80,
      name: 'image',
      mime: assetId === 'matted' ? 'image/png' : 'image/jpeg',
    },
  })
}

const original: SourceBytes = {
  assetId: 'original',
  blob: new Blob(['original-bytes'], { type: 'image/jpeg' }),
  mime: 'image/jpeg',
}

function encoder() {
  return vi.fn(
    async (_bitmap: ImageBitmap, mime: string) => new Blob([`encoded:${mime}`], { type: mime }),
  )
}

describe('bytesForSource', () => {
  it('D2-F12: re-encodes for the asset the document moved to, not the bytes it imported', async () => {
    const encode = encoder()
    const bytes = await bytesForSource({
      doc: docFor('matted'),
      bitmap: { width: 100, height: 80 } as ImageBitmap,
      known: original,
      encode,
    })
    expect(bytes?.assetId).toBe('matted')
    expect(bytes?.mime).toBe(REPLACEMENT_MIME)
    expect(encode).toHaveBeenCalledOnce()
  })

  it('D2-F11: reuses the bytes it already has while the asset id is unchanged', async () => {
    const encode = encoder()
    const bytes = await bytesForSource({
      doc: docFor('original'),
      bitmap: { width: 100, height: 80 } as ImageBitmap,
      known: original,
      encode,
    })
    expect(bytes).toBe(original)
    expect(encode).not.toHaveBeenCalled()
  })

  it('has nothing to persist without a source asset', async () => {
    expect(await bytesForSource({ doc: createDoc(), bitmap: null, known: original })).toBeNull()
  })

  it('cannot persist bytes it does not have', async () => {
    expect(
      await bytesForSource({ doc: docFor('matted'), bitmap: null, known: original }),
    ).toBeNull()
  })
})
