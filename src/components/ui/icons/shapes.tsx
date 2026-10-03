import type { ShapeLayer } from '../../../model/types'
import { icon, type IconComponent } from './base'

/** The four tools the shape layer can draw. */
const rectShapeGlyph = icon(<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />)

const ellipseShapeGlyph = icon(<ellipse cx="12" cy="12" rx="8.5" ry="7" />)

/** A line as it is *drawn* — one stroke, no container, no caps. */
const lineShapeGlyph = icon(<line x1="4" y1="20" x2="20" y2="4" />)

/** A line with a solid head, so it cannot be confused with `ArrowRightGlyph`'s open chevron. */
const arrowShapeGlyph = icon(
  <>
    <line x1="4" y1="20" x2="14.5" y2="10.5" />
    <path d="M10.5 6.5h8v8z" fill="currentColor" stroke="none" />
  </>,
)

export const SHAPE_GLYPHS: Record<ShapeLayer['shape'], IconComponent> = {
  rect: rectShapeGlyph,
  ellipse: ellipseShapeGlyph,
  line: lineShapeGlyph,
  arrow: arrowShapeGlyph,
}
