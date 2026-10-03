export type Rgb = [number, number, number]

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Parse `#rgb` / `#rrggbb`, with or without the leading `#`, into linear
 * 0..1 components. Returns `null` for everything else — named colours and
 * `'transparent'` are not hex, and a caller that gets `null` has to pick its
 * own fallback. Guessing a hue here is what used to paint every JPEG/PDF
 * export orange.
 */
export function parseHexColor(value: string): Rgb | null {
  const match = HEX.exec(value.trim())
  if (!match) return null
  const digits = match[1]
  const full = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits
  const int = parseInt(full, 16)
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
}
