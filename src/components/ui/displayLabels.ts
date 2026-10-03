import {
  BLEND_LABELS,
  BRUSHES,
  LAYER_TRANSFORM_PARTS,
  REDACT_MODES,
  blendModes,
} from '../../features/layers/factory'
import type {
  BlendMode,
  DrawLayer,
  FrameStyle,
  LayerKind,
  RedactLayer,
  ShapeLayer,
} from '../../model/types'

/**
 * The words a user reads instead of the identifiers the document stores.
 *
 * Six unions reach the screen from `LayerPanels.tsx` — frame style, brush,
 * shape, layer kind, blend mode and redaction mode — and every one of them used
 * to be printed raw. `solid`, `pen`, `rect`, `shadow-card` and the `text · ` on
 * the front of every layer row are all what the code calls them and not one of
 * them is what they mean.
 *
 * The `Record<>` over the union is the load-bearing part. Adding a member to
 * `FrameStyle` is a compile error in this file until somebody decides what the
 * new style is called, and a typo'd or stale key is a compile error too — which
 * is the failure a plain `Record<string, string>` lookup quietly allows and the
 * one this file exists to make impossible. The runtime half of the same
 * invariant is in `displayLabels.test.ts`, which checks these tables against
 * `blendModes()` / `BRUSHES` / `REDACT_MODES` and against the glyph tables in
 * `./icons` — `Record<>` over the same unions, written by somebody else.
 *
 * Two of the six have no list to iterate (`FrameStyle` and `ShapeLayer['shape']`
 * are only ever written out as an inline tuple inside a component), so they are
 * declared here and consumed from here. That makes this module the single place
 * the order and the membership of those two are decided.
 */

/** What each frame style is called. Read next to a frame chip, and as a row's detail. */
export const FRAME_STYLE_LABELS: Record<FrameStyle, string> = {
  solid: 'Solid',
  inset: 'Inset',
  polaroid: 'Polaroid',
  film: 'Film strip',
  rounded: 'Rounded',
  'shadow-card': 'Shadow card',
}

/**
 * The four shapes a shape layer can draw. `rect` became "Rectangle" rather than
 * "Rect" because the row a user finds a shape by is the one place the word is
 * seen without a glyph next to it.
 */
export const SHAPE_LABELS: Record<ShapeLayer['shape'], string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
}

/**
 * The five brushes. `highlighter` was the one id that *was* already title-cased,
 * as the inconsistent special case `'highlighter' ? 'Highlight' : brush`, and
 * 'Highlighter' keeps it in step with the other four nouns.
 */
export const BRUSH_LABELS: Record<DrawLayer['brush'], string> = {
  pen: 'Pen',
  marker: 'Marker',
  highlighter: 'Highlighter',
  neon: 'Neon',
  eraser: 'Eraser',
}

/**
 * The four redaction modes. These are unchanged from what the panel already
 * showed, which is deliberate: the group is labelled "Redaction mode", so
 * "Solid" inside it is unambiguous and needs no second word.
 */
export const REDACT_MODE_LABELS: Record<RedactLayer['mode'], string> = {
  pixelate: 'Pixelate',
  blur: 'Blur',
  solid: 'Solid',
  emoji: 'Emoji',
}

/**
 * The seven layer kinds, as a row's prefix. `draw` reads "Drawing" rather than
 * "Draw", because the word is describing the layer, not the gesture — the same
 * distinction the panel already draws with "New drawing layer".
 */
export const LAYER_KIND_LABELS: Record<LayerKind, string> = {
  text: 'Text',
  sticker: 'Sticker',
  shape: 'Shape',
  draw: 'Drawing',
  redact: 'Redaction',
  watermark: 'Watermark',
  frame: 'Frame',
}

/**
 * The blend names in full, for the `title` tooltip.
 *
 * `BLEND_LABELS` abbreviates two of them — `soft-light` is "Soft" — and its own
 * comment claims the full name is the tooltip. No tooltip existed. `title` is
 * the last step of the accessible-name algorithm, so a `title` beside real button
 * text changes nothing a screen reader or a `getByRole` locator sees; it adds the
 * hover affordance the comment describes without touching the accessible name.
 */
export const BLEND_MODE_TITLES: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'soft-light': 'Soft light',
  'hard-light': 'Hard light',
}

/**
 * `BLEND_LABELS` is re-exported rather than copied.
 *
 * It already lives in `features/layers/factory.ts` beside `blendModes()`, it is
 * already `Record<BlendMode, string>`, and a second copy here would be two
 * tables free to disagree — which is the same rot as a lookup with a hole in it,
 * one level up. Re-exporting means the panel has one import for every name it
 * prints and there is still one blend table in the repository.
 */
export { BLEND_LABELS }

/** The six frame styles, in the order the picker shows them. */
export const FRAME_STYLES: readonly FrameStyle[] = [
  'solid',
  'inset',
  'polaroid',
  'film',
  'rounded',
  'shadow-card',
]

/** The four shapes, in the order the picker shows them. */
export const SHAPES: readonly ShapeLayer['shape'][] = ['rect', 'ellipse', 'line', 'arrow']

/**
 * The seven layer kinds, read off `LAYER_TRANSFORM_PARTS`.
 *
 * That table is `Record<LayerKind, …>` and the compiler has already proved it
 * has a key for every kind, so the cast is sound rather than a claim — and it
 * cannot drift, because adding a kind without adding a transform breaks that
 * table's own type first.
 */
export const LAYER_KINDS: readonly LayerKind[] = Object.keys(LAYER_TRANSFORM_PARTS) as LayerKind[]

/**
 * Every union this module names, with the list its members are checked against.
 *
 * The lists are the repository's own runtime witnesses — `blendModes()`,
 * `BRUSHES`, `REDACT_MODES` from the factory, and the two declared above — so
 * `displayLabels.test.ts` can prove all three things at once: every member has a
 * label, no label is an orphan, and no label is the identifier it replaces.
 */
export const DISPLAY_LABEL_TABLES: readonly {
  name: string
  members: readonly string[]
  labels: Readonly<Record<string, string>>
}[] = [
  { name: 'FrameStyle', members: FRAME_STYLES, labels: FRAME_STYLE_LABELS },
  { name: 'LayerKind', members: LAYER_KINDS, labels: LAYER_KIND_LABELS },
  { name: "DrawLayer['brush']", members: BRUSHES, labels: BRUSH_LABELS },
  { name: "ShapeLayer['shape']", members: SHAPES, labels: SHAPE_LABELS },
  { name: "RedactLayer['mode']", members: REDACT_MODES, labels: REDACT_MODE_LABELS },
  { name: 'BlendMode', members: blendModes(), labels: BLEND_LABELS },
  { name: 'BlendMode titles', members: blendModes(), labels: BLEND_MODE_TITLES },
]
