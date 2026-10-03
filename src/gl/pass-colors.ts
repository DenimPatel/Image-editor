import { parseHexColor, type Rgb } from '../lib/hex-color'

/**
 * Parsed colour for a shader or pixel-pass uniform. Anything that is not
 * `#rgb`/`#rrggbb` — a named colour, `transparent`, a value migrated in from an
 * older document — falls back to white rather than to a guessed hue, which is
 * what the Canvas2D backend paints for the same inputs.
 */
export const NEUTRAL_FILL: Rgb = [1, 1, 1]

export function hexToRgb(hex: string, fallback: Rgb = NEUTRAL_FILL): Rgb {
  return parseHexColor(hex) ?? fallback
}
