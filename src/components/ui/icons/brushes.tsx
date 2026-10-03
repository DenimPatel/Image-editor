import type { DrawLayer } from '../../../model/types'
import { icon, type IconComponent } from './base'

/**
 * The five brushes.
 *
 * These are the one place in the system where the glyphs are *supposed* to
 * differ in weight, because the brushes genuinely differ in the four numbers
 * `BRUSH_STYLES` in `features/layers/factory.ts` records — width scale, alpha,
 * composite and softness. A row of five identical hairlines labelled Pen,
 * Marker, Highlighter, Neon, Eraser is a row of five identical hairlines; so
 * the stroke width, opacity and cap shape here mirror the values the compositor
 * actually uses, and this is the only place in the system that departs from
 * the 2-unit base weight on purpose.
 */
const STROKE = 'M2.5 17.5 21.5 11'

/** 1.0×, alpha 1, no softness: the family weight, a single sure line. */
const penGlyph = icon(<path d={STROKE} />)

/** 1.7× at 0.9 alpha: a fatter stroke that still reads as one confident line. */
const markerGlyph = icon(<path d={STROKE} strokeWidth="3.4" strokeOpacity="0.9" />)

/**
 * 3.2× at 0.35 alpha over a multiply composite: a wide translucent band with a
 * flat chisel end, laid over the crisp stroke it is passing across — which is
 * what a highlighter does to a line of text.
 */
const highlighterGlyph = icon(
  <>
    <path d={STROKE} strokeWidth="1.5" />
    <path d="M2.5 15 21.5 8.5v5L2.5 20Z" fill="currentColor" fillOpacity="0.35" stroke="none" />
  </>,
)

/** A 1.6 glow: a soft halo around a bright core. */
const neonGlyph = icon(
  <>
    <path d={STROKE} strokeWidth="5.5" strokeOpacity="0.22" />
    <path d={STROKE} strokeWidth="1.5" />
  </>,
)

/** 1.4× composited `destination-out`: a block rubbing out a dashed stroke. */
const eraserGlyph = icon(
  <>
    <path d="M3 21c3-1 4.5-2.5 6-4.5" strokeDasharray="3 2.5" />
    <path d="M14 3.5 21 10.5 14.5 17 7.5 10Z" />
  </>,
)

export const BRUSH_GLYPHS: Record<DrawLayer['brush'], IconComponent> = {
  pen: penGlyph,
  marker: markerGlyph,
  highlighter: highlighterGlyph,
  neon: neonGlyph,
  eraser: eraserGlyph,
}
