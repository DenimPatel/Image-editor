/**
 * The icon system.
 *
 * One grid (24×24), one weight (a 2-unit round stroke, `currentColor`, no
 * intrinsic size), one factory, one accessibility contract, and a signature on
 * every glyph so a shape can only exist once.
 *
 * Two files used to disagree about all of that — `icons.tsx` had seven glyphs
 * with one `base` and a props type of `{ className?: string }`,
 * `editorIcons.tsx` had twenty-six with a different `base` and the full
 * `SVGProps` — and they shared two shapes byte for byte, which is how a glyph
 * ends up meaning two things and nobody notices. This directory is the single
 * source; both files are gone.
 *
 * Conventions: `*Glyph` for a shape, `*Glyphs`/`*_GLYPHS` for a lookup keyed
 * by a domain id, and a component (not a lookup entry) where a caller already
 * holds the domain object — `AdjustIcon` takes the spec, not the key.
 */
export { ICON_BASE, icon, iconWith, type IconComponent, type IconProps } from './base'
export { hashSignature, signatureOf } from './signature'

export {
  AdjustToolGlyph,
  BackgroundToolGlyph,
  CropToolGlyph,
  DrawToolGlyph,
  ExportToolGlyph,
  FilterToolGlyph,
  FrameToolGlyph,
  LayersToolGlyph,
  PassportToolGlyph,
  RedactToolGlyph,
  RetouchToolGlyph,
  StickerToolGlyph,
  TextToolGlyph,
} from './toolTabs'

export {
  ArrowRightGlyph,
  CheckGlyph,
  ChevronLeftGlyph,
  ChevronRightGlyph,
  CloseGlyph,
  CompareGlyph,
  EyeGlyph,
  EyeOffGlyph,
  FlipHorizontalGlyph,
  InfoGlyph,
  KeyboardGlyph,
  MoonGlyph,
  MoreGlyph,
  PauseGlyph,
  PlayGlyph,
  PasteGlyph,
  PlusGlyph,
  RedoGlyph,
  SaveGlyph,
  SparkleGlyph,
  StraightenGlyph,
  SunGlyph,
  TrashGlyph,
  UndoGlyph,
  WorkspaceGlyph,
} from './chrome'

export { ArchiveGlyph, CancelGlyph, CopyGlyph, DownloadGlyph, ShareGlyph } from './exportActions'

export {
  FillFrameGlyph,
  FlipRotateGlyph,
  RotateLeftGlyph,
  RotateRightGlyph,
  SwapRatioGlyph,
} from './cropActions'

export { ADJUST_GLYPHS, AdjustIcon } from './adjustments'

export { SHAPE_GLYPHS } from './shapes'
export { FRAME_GLYPHS } from './frames'
export { BRUSH_GLYPHS } from './brushes'
export { BLEND_GLYPHS } from './blends'
export { REDACT_MODE_GLYPHS } from './redactModes'

export {
  ASPECT_GLYPHS,
  AspectRatioGlyph,
  LandscapeRatioGlyph,
  PortraitRatioGlyph,
  SquareRatioGlyph,
  viewfinderBox,
  type AspectKind,
  type ViewfinderBox,
} from './aspect'

export { STICKER_ART, STICKER_GLYPHS, type StickerArt, type StickerId } from './stickers'
