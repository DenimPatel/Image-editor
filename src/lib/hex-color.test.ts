import { describe, expect, it } from 'vitest'
import { parseHexColor } from './hex-color'

describe('parseHexColor', () => {
  it('parses six-digit hex', () => {
    expect(parseHexColor('#aabbcc')).toEqual([170 / 255, 187 / 255, 204 / 255])
    expect(parseHexColor('#000000')).toEqual([0, 0, 0])
    expect(parseHexColor('#ffffff')).toEqual([1, 1, 1])
  })

  it('parses three-digit hex by doubling each nibble', () => {
    expect(parseHexColor('#fff')).toEqual([1, 1, 1])
    expect(parseHexColor('#abc')).toEqual([0xaa / 255, 0xbb / 255, 0xcc / 255])
    expect(parseHexColor('#000')).toEqual([0, 0, 0])
  })

  it('accepts a missing hash, upper case and surrounding whitespace', () => {
    expect(parseHexColor('aabbcc')).toEqual([170 / 255, 187 / 255, 204 / 255])
    expect(parseHexColor('#AABBCC')).toEqual([170 / 255, 187 / 255, 204 / 255])
    expect(parseHexColor('  #fff  ')).toEqual([1, 1, 1])
  })

  it('rejects named colours and the transparent keyword', () => {
    expect(parseHexColor('transparent')).toBeNull()
    expect(parseHexColor('white')).toBeNull()
    expect(parseHexColor('rgb(0,0,0)')).toBeNull()
  })

  it('rejects junk and wrong-length hex', () => {
    for (const junk of [
      '',
      '#',
      '#ff',
      '#ffff',
      '#fffff',
      '#fffffff',
      '#gggggg',
      '#12 456',
      'nope',
    ]) {
      expect(parseHexColor(junk)).toBeNull()
    }
  })
})
