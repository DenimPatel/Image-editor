import { describe, expect, it } from 'vitest'
import { convertBytes, displayUnit, parseRatio } from './format'

describe('convertBytes', () => {
  it('formats bytes below 1024 as Bytes', () => {
    expect(convertBytes(0)).toBe('0 Bytes')
    expect(convertBytes(1023)).toBe('1023 Bytes')
  })

  it('formats 1024 and up (but below 1MB) as KB', () => {
    expect(convertBytes(1024)).toBe('1 KB')
    expect(convertBytes(1048575)).toBe('1024 KB')
  })

  it('formats 1MB and up as MB', () => {
    expect(convertBytes(1048576)).toBe('1 MB')
    expect(convertBytes(5242880)).toBe('5 MB')
  })

  it('never prints a hundredth that is all zeros', () => {
    // The import ceiling is a round number of megabytes, so it used to read
    // "up to 256.00 MB" and an export estimate read "236.10 KB" — precision the
    // figure cannot support, printed in the one place the user compares it to a
    // limit. A trailing tenth goes with the trailing hundredths.
    expect(convertBytes(256 * 1024 * 1024)).toBe('256 MB')
    expect(convertBytes(Math.round(236.1 * 1024))).toBe('236 KB')
    expect(convertBytes(Math.round(220.1 * 1024))).toBe('220 KB')
    expect(convertBytes(500 * 1024)).toBe('500 KB')
  })

  it('keeps the decimals that are information', () => {
    // A hundredth of a kilobyte is ten bytes and a tenth is a hundred, so these
    // decimals are the measurement rather than noise: dropping them would say two
    // different estimates were the same figure.
    expect(convertBytes(Math.round(1.18 * 1048576))).toBe('1.18 MB')
    expect(convertBytes(Math.round(236.57 * 1024))).toBe('236.57 KB')
    expect(convertBytes(Math.round(500.55 * 1024))).toBe('500.55 KB')
    // The export estimate in the panel, which is where the noise used to show.
    expect(convertBytes(Math.round(220.13 * 1024))).toBe('220.13 KB')
  })

  it('does not depend on how the float lands', () => {
    // `236.1` is not exactly 236.1 in binary, so a "within a tenth" test passes
    // or fails by eight orders of magnitude of rounding noise. The hundredths
    // are integers before anything is compared.
    for (let kb = 1; kb < 1020; kb += 7) {
      const text = convertBytes(Math.round(kb * 1024))
      const match = text.match(/^(\d+)(?:\.(\d{2}))? KB$/)
      expect(match, text).not.toBeNull()
      expect(text.endsWith('.0 KB'), text).toBe(false)
    }
    expect(convertBytes(Math.round(1.01 * 1048576))).toBe('1.01 MB')
    // The cost of the rule, stated so it cannot change unnoticed: a lone trailing
    // tenth is dropped whatever the unit, so 12.1 MB reads "12 MB". The figure is
    // an estimate prefixed with `~`, and the alternative — a lone trailing tenth
    // kept in KB and dropped in MB — is two spellings of one unit.
    expect(convertBytes(Math.round(12.1 * 1048576))).toBe('12 MB')
    expect(convertBytes(Math.round(12.15 * 1048576))).toBe('12.15 MB')
  })
})

describe('displayUnit', () => {
  it('puts a space before a letter unit and nothing before a symbol', () => {
    // `DialSlider` and `ParameterRow` concatenate, so an unspaced "EV" arrives
    // glued to its figure as "0EV". A degree sign and a percent sign are symbols,
    // not words, and take no space: "12.0°" and "50%" are right as they are.
    expect(displayUnit('EV')).toBe(' EV')
    expect(displayUnit('%')).toBe('%')
    expect(displayUnit('°')).toBe('°')
  })

  it('is empty for a unit-less control', () => {
    expect(displayUnit(undefined)).toBe('')
    expect(displayUnit('')).toBe('')
  })

  it('spaces the unit exactly once', () => {
    expect(displayUnit(displayUnit('EV'))).toBe(' EV')
  })
})

describe('parseRatio', () => {
  it('parses a valid "W:H" ratio', () => {
    expect(parseRatio('3:2')).toEqual({ width: 3, height: 2 })
    expect(parseRatio('1:1')).toEqual({ width: 1, height: 1 })
    expect(parseRatio('16.5:9')).toEqual({ width: 16.5, height: 9 })
  })

  it('rejects "0:0" instead of allowing a divide-by-zero', () => {
    expect(parseRatio('0:0')).toBeNull()
  })

  it('rejects negative values', () => {
    expect(parseRatio('-1:2')).toBeNull()
    expect(parseRatio('1:-2')).toBeNull()
  })

  it('rejects non-numeric input without throwing', () => {
    expect(() => parseRatio('abc')).not.toThrow()
    expect(parseRatio('abc')).toBeNull()
    expect(parseRatio('abc:2')).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(parseRatio('3')).toBeNull()
    expect(parseRatio('3:2:1')).toBeNull()
    expect(parseRatio('')).toBeNull()
  })
})
