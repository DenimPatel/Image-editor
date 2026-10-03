import { describe, expect, it } from 'vitest'
import {
  ACCEPT_ATTR,
  describeOversized,
  describeUnsupported,
  isHeic,
  MAX_INPUT_BYTES,
} from './accept'

function file(name: string, type: string, size = 1024): File {
  return { name, type, size } as File
}

describe('isHeic', () => {
  it('recognises HEIC by type or by extension', () => {
    expect(isHeic('image/heic', 'photo.jpg')).toBe(true)
    expect(isHeic('image/heif-sequence', 'photo.jpg')).toBe(true)
    expect(isHeic('', 'IMG_0042.HEIC')).toBe(true)
    expect(isHeic('', 'clip.mov')).toBe(false)
    expect(isHeic('image/jpeg', 'photo.jpg')).toBe(false)
  })
})

describe('describeUnsupported', () => {
  it('explains HEIC differently from an unknown type', () => {
    const heic = describeUnsupported(file('photo.heic', 'image/heic'))
    expect(heic).toContain('HEIC/HEIF')
    expect(describeUnsupported(file('thing.bin', 'application/octet-stream'))).toContain(
      'isn’t supported',
    )
    expect(describeUnsupported(file('photo.raw', 'image/x-raw'))).not.toBe(heic)
  })

  it('accepts every format the input advertises', () => {
    for (const type of ACCEPT_ATTR.split(',')) {
      expect(describeUnsupported(file('photo', type))).toBeNull()
    }
  })

  it('D7-F03: refuses a file too large to decode, before anything is read', () => {
    const result = describeUnsupported(file('huge.jpg', 'image/jpeg', MAX_INPUT_BYTES + 1))
    expect(result).toBe(describeOversized(MAX_INPUT_BYTES + 1))
    expect(result).toContain('256 MB')
    expect(result).not.toMatch(/256\.00/)
    expect(describeUnsupported(file('ok.jpg', 'image/jpeg', MAX_INPUT_BYTES))).toBeNull()
  })
})
