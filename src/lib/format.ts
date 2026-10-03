/**
 * A byte count as a human-readable string (Bytes / KB / MB).
 *
 * Two decimals was the shape it shipped with, and every one of them was noise:
 * the file ceiling read "up to 256.00 MB" and an export estimate read "236.10
 * KB". The shortest honest form of a byte count is the last decimal that is
 * still information, so `256 MB`, `236 KB`, `1.18 MB` — and every call site in
 * the app changes at once, rather than the import screen alone.
 */
export function convertBytes(bytesSize: number): string {
  if (bytesSize < 1024) {
    return `${bytesSize} Bytes`
  }
  if (bytesSize < 1048576) {
    return `${sized(bytesSize / 1024)} KB`
  }
  return `${sized(bytesSize / 1048576)} MB`
}

/**
 * The shortest figure that is still true.
 *
 * Worked in hundredths rather than compared against a fraction, because
 * "within a tenth of a whole number" is a float comparison — `236.10` misses the
 * test by eight orders of magnitude of floating-point noise, and the day it
 * passes the day a byte count changes shape. A hundredth of a kilobyte is ten
 * bytes, so a figure whose last tenth is zero is a figure quoting precision the
 * byte count cannot support: `236.10 KB` is `236 KB`. Anything with a hundredth
 * that says something keeps both decimals.
 */
function sized(value: number): string {
  const hundredths = Math.round(value * 100)
  if (hundredths % 10 === 0) return `${Math.round(hundredths / 100)}`
  const whole = Math.floor(hundredths / 100)
  const rest = String(hundredths % 100).padStart(2, '0')
  return `${whole}.${rest}`
}

/**
 * A unit, spaced the way the number beside it needs it.
 *
 * `DialSlider` and `ParameterRow` build their readouts by concatenation, so a
 * unit arrives glued to its figure unless the caller has already spaced it:
 * `0EV`. The space belongs to the letter units and not to the symbols — `0 EV`
 * is right and `0%` and `12.0°` are right as they are, because a percent sign
 * and a degree sign are symbols rather than words and take no space in any
 * style manual. Fixing it at the call site is also the only place it can be
 * fixed without changing what the controls do for every other panel.
 */
export function displayUnit(unit?: string): string {
  if (!unit) return ''
  return /^[A-Za-z]/.test(unit) ? ` ${unit}` : unit
}

export type ParsedRatio = { width: number; height: number }

/**
 * Parse a "W:H" aspect ratio string. Returns null for malformed input,
 * non-finite values, or non-positive sides (e.g. "0:0", "-1:2", "abc") —
 * app.py divided by zero on these instead of rejecting them.
 */
export function parseRatio(input: string): ParsedRatio | null {
  const parts = input.split(':')
  if (parts.length !== 2) return null

  const width = Number(parts[0].trim())
  const height = Number(parts[1].trim())

  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null

  return { width, height }
}
