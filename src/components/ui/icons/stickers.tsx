import { icon, type IconComponent } from './base'

/**
 * The built-in sticker set, promoted out of `features/layers/stickers.ts`.
 *
 * That module already carried `path` and `fill` for all eight and
 * `LayerPanels.tsx` printed `{sticker.label}` instead, so the artwork was in
 * the codebase and unused. `stickers.ts` is drawn into a canvas through
 * `Path2D` at a 100-unit viewBox in its brand colour; these are the same paths
 * as 24-grid thumbnails for the picker.
 *
 * The direction of the dependency is deliberate: this module does **not** import
 * `stickers.ts`. That file reaches `decodeImageBlob`, `createId` and
 * `defaultTransform`, and an icon barrel that pulled those in would put image
 * decoding on the critical path of every page that draws a toolbar. So the
 * data is declared here and `icons.test.tsx` asserts it is byte-identical to
 * the original — which is what makes the temporary duplication safe: change one
 * side and the test names the other.
 *
 * When `stickers.ts` is next edited, this becomes the source of truth and
 * `STICKERS` should import from here.
 */
export type StickerId =
  'star' | 'heart' | 'bolt' | 'check' | 'arrow' | 'sparkle' | 'circle' | 'speech'

export type StickerArt = {
  id: StickerId
  label: string
  viewBox: number
  path: string
  fill: string
}

export const STICKER_ART: Record<StickerId, StickerArt> = {
  star: {
    id: 'star',
    label: 'Star',
    viewBox: 100,
    path: 'M50 5l14 29 32 4-23 22 6 32-29-15-29 15 6-32L4 38l32-4z',
    fill: '#ffd166',
  },
  heart: {
    id: 'heart',
    label: 'Heart',
    viewBox: 100,
    path: 'M50 88S12 62 12 36a20 20 0 0 1 38-9 20 20 0 0 1 38 9c0 26-38 52-38 52z',
    fill: '#ef476f',
  },
  bolt: {
    id: 'bolt',
    label: 'Bolt',
    viewBox: 100,
    path: 'M58 4L20 56h22l-6 40 40-54H52z',
    fill: '#ffd166',
  },
  check: {
    id: 'check',
    label: 'Check',
    viewBox: 100,
    path: 'M42 66L22 46l-8 8 28 28 48-56-9-8z',
    fill: '#06d6a0',
  },
  arrow: {
    id: 'arrow',
    label: 'Arrow',
    viewBox: 100,
    path: 'M10 44h52V24l30 28-30 28V60H10z',
    fill: '#118ab2',
  },
  sparkle: {
    id: 'sparkle',
    label: 'Sparkle',
    viewBox: 100,
    path: 'M50 6l8 28 28 8-28 8-8 28-8-28-28-8 28-8z',
    fill: '#f78c6b',
  },
  circle: {
    id: 'circle',
    label: 'Ring',
    viewBox: 100,
    path: 'M50 10a40 40 0 1 0 0 80 40 40 0 0 0 0-80zm0 12a28 28 0 1 1 0 56 28 28 0 0 1 0-56z',
    fill: '#ffffff',
  },
  speech: {
    id: 'speech',
    label: 'Speech',
    viewBox: 100,
    path: 'M14 18h72v46H44L22 84V64H14z',
    fill: '#ffffff',
  },
}

/**
 * 100-unit artwork scaled onto the 24 grid. The `currentColor` outline is
 * scaled with it (6 × 0.24 ≈ 1.44 grid units) and is what makes the two
 * white-filled stickers — the ring and the speech bubble — visible at all
 * against a light panel.
 */
function thumbnail(art: StickerArt): IconComponent {
  return icon(
    <g transform="scale(0.24)">
      <path d={art.path} fill={art.fill} stroke="currentColor" strokeWidth="6" />
    </g>,
  )
}

export const STICKER_GLYPHS: Record<StickerId, IconComponent> = {
  star: thumbnail(STICKER_ART.star),
  heart: thumbnail(STICKER_ART.heart),
  bolt: thumbnail(STICKER_ART.bolt),
  check: thumbnail(STICKER_ART.check),
  arrow: thumbnail(STICKER_ART.arrow),
  sparkle: thumbnail(STICKER_ART.sparkle),
  circle: thumbnail(STICKER_ART.circle),
  speech: thumbnail(STICKER_ART.speech),
}
