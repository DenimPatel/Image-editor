/**
 * Passport / ID photo specifications.
 *
 * All physical dimensions are millimetres so they can be converted to pixels
 * at the required print DPI by `mmToPx`. Head height is chin-to-crown and the
 * eye line is measured from the bottom edge of the photo.
 *
 * A spec publishes two independent numbers and nothing connects them, but a
 * photo can only honour both if the eye line falls *inside* the head — and the
 * midpoints of the two ranges are not jointly placeable. `us-2x2` is the
 * clearest case: 31.75 mm of eye line plus a 30.16 mm head is 61.9 mm of face
 * in a 50.8 mm photo, so any framer that put the crown a whole head-height
 * above the eye line cropped 11 mm off the top of the head (D5-F11).
 * `specGeometry` is what connects them: the eye line sits a fixed fraction of
 * the way up the head, so a head height plus that fraction places a crown, and
 * the two ranges can be solved together instead of averaged separately.
 */

export type PassportBackground = 'white' | 'light-grey' | 'any'

/** Where the eye line sits inside the head, as a fraction of chin-to-crown height. */
export const EYE_HEIGHT_IN_HEAD = 0.45

/** Clear space the solved framing keeps above the crown and below the chin. */
export const FRAME_MARGIN_MM = 2

/** Candidates tried across the head-height range when solving head + eye together. */
const HEAD_STEPS = 9

export type PassportSpec = {
  id: string
  label: string
  country: string
  widthMm: number
  heightMm: number
  dpi: number
  headHeightMm: { min: number; max: number }
  eyeLineMmFromBottom: { min: number; max: number }
  background: PassportBackground
  notes: string[]
}

/**
 * One self-consistent placement of the head inside a spec's frame. Both
 * numbers are inside the spec's own ranges, and `crownClearanceMm` /
 * `chinClearanceMm` are the clear space left above the crown and below the
 * chin, so a caller can tell a real band from a degenerate one without
 * recomputing the anatomy.
 */
export type SpecGeometry = {
  /** Chin-to-crown height the framing targets, in mm. */
  headMm: number
  /** Eye line from the bottom edge the framing targets, in mm. */
  eyeMm: number
  /** Chin distance from the bottom edge, in mm. */
  chinMm: number
  /** Crown distance from the bottom edge, in mm. */
  crownMm: number
  /** Clear space above the crown. Negative only when `degenerate`. */
  crownClearanceMm: number
  /** Clear space below the chin. Negative only when `degenerate`. */
  chinClearanceMm: number
  /**
   * True when the spec's own ranges cannot hold a head inside its frame, even
   * at the hard edges. A degenerate spec still renders guides — clamped and
   * labelled — but the panel warns rather than implying the numbers work.
   */
  degenerate: boolean
}

function midOf(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2
}

type Placement = { headMm: number; eyeMm: number; clearanceMm: number }

/**
 * Eye positions allowed for a given head height, keeping `margin` mm of clear
 * space at the top and bottom of the frame. Returns null when the head height
 * leaves no legal eye position, which is what makes a spec degenerate.
 */
function eyeRangeForHead(
  spec: PassportSpec,
  headMm: number,
  margin: number,
): { min: number; max: number } | null {
  const eyeToChin = EYE_HEIGHT_IN_HEAD * headMm
  const eyeToCrown = headMm - eyeToChin
  const min = Math.max(spec.eyeLineMmFromBottom.min, eyeToChin + margin)
  const max = Math.min(spec.eyeLineMmFromBottom.max, spec.heightMm - eyeToCrown - margin)
  return max >= min ? { min, max } : null
}

/**
 * Solve head height and eye line together instead of averaging each range on
 * its own: pick the head height, inside the spec's range, that lets the eye
 * line sit closest to the middle of *its* range while the crown and chin both
 * clear the frame edges.
 */
function solvePlacement(spec: PassportSpec, margin: number): Placement | null {
  const midHead = midOf(spec.headHeightMm)
  const midEye = midOf(spec.eyeLineMmFromBottom)
  const headSpan = Math.max(1e-6, spec.headHeightMm.max - spec.headHeightMm.min)
  const eyeSpan = Math.max(1e-6, spec.eyeLineMmFromBottom.max - spec.eyeLineMmFromBottom.min)
  let best: Placement | null = null
  let bestCost = Infinity

  for (let i = 0; i < HEAD_STEPS; i += 1) {
    const headMm =
      spec.headHeightMm.min +
      ((spec.headHeightMm.max - spec.headHeightMm.min) * i) / (HEAD_STEPS - 1)
    const range = eyeRangeForHead(spec, headMm, margin)
    if (!range) continue
    const eyeMm = Math.min(range.max, Math.max(range.min, midEye))
    const cost = Math.hypot((headMm - midHead) / headSpan, (eyeMm - midEye) / eyeSpan)
    if (cost < bestCost) {
      bestCost = cost
      best = { headMm, eyeMm, clearanceMm: margin }
    }
  }
  return best
}

/**
 * The advisory framing for a spec: which head height and eye line a correctly
 * taken photo for this spec should show. Non-degenerate for every shipped
 * spec, and asserted so in `specs.test.ts`.
 */
export function specGeometry(spec: PassportSpec): SpecGeometry {
  const solve = (margin: number) => solvePlacement(spec, margin)
  const placement = solve(FRAME_MARGIN_MM) ?? solve(0) ?? null

  if (!placement) {
    // No head height in the spec's range leaves a legal eye position even with
    // the frame edges touching the head. Clamp to the nearest attempt so the
    // guides still draw something and the caller can show the warning.
    const headMm = midOf(spec.headHeightMm)
    const eyeToChin = EYE_HEIGHT_IN_HEAD * headMm
    const eyeMm = Math.min(
      spec.eyeLineMmFromBottom.max,
      Math.max(spec.eyeLineMmFromBottom.min, eyeToChin),
    )
    const chinMm = eyeMm - eyeToChin
    const crownMm = eyeMm + (headMm - eyeToChin)
    return {
      headMm,
      eyeMm,
      chinMm,
      crownMm,
      crownClearanceMm: spec.heightMm - crownMm,
      chinClearanceMm: chinMm,
      degenerate: true,
    }
  }

  const eyeToChin = EYE_HEIGHT_IN_HEAD * placement.headMm
  const chinMm = placement.eyeMm - eyeToChin
  const crownMm = chinMm + placement.headMm
  return {
    headMm: placement.headMm,
    eyeMm: placement.eyeMm,
    chinMm,
    crownMm,
    crownClearanceMm: spec.heightMm - crownMm,
    chinClearanceMm: chinMm,
    degenerate: placement.clearanceMm < FRAME_MARGIN_MM,
  }
}

export const PASSPORT_SPECS: PassportSpec[] = [
  {
    id: 'us-2x2',
    label: 'US Passport 2 × 2 in',
    country: 'United States',
    widthMm: 50.8,
    heightMm: 50.8,
    dpi: 300,
    headHeightMm: { min: 25.4, max: 34.925 },
    eyeLineMmFromBottom: { min: 28.575, max: 34.925 },
    background: 'white',
    notes: [
      'Face the camera directly with a neutral expression and both eyes open.',
      'Use a plain white or off-white background with no shadows.',
      'Head must be 25.4–34.925 mm from chin to crown — the document states this as 1 in to 1 3/8 in.',
      'No glasses, hats or head coverings except for religious reasons.',
    ],
  },
  {
    id: 'us-visa-2x2',
    label: 'US Visa 2 × 2 in',
    country: 'United States',
    widthMm: 50.8,
    heightMm: 50.8,
    dpi: 300,
    headHeightMm: { min: 25.4, max: 34.925 },
    eyeLineMmFromBottom: { min: 28.575, max: 34.925 },
    background: 'white',
    notes: [
      'Photo must be exactly 2 × 2 in with the head centred.',
      'Eye height must be 28.575–34.925 mm from the bottom edge — the document states this as 1 1/8 in to 1 3/8 in.',
      'Neutral expression, no uniform, plain white background.',
      'Taken within the last six months.',
    ],
  },
  {
    id: 'india-2x2',
    label: 'India Passport 2 × 2 in',
    country: 'India',
    widthMm: 51,
    heightMm: 51,
    dpi: 300,
    headHeightMm: { min: 25, max: 35 },
    eyeLineMmFromBottom: { min: 28, max: 34 },
    background: 'white',
    notes: [
      'Photo size 51 × 51 mm with a plain white background.',
      'Face should fill most of the frame with a visible full frontal view.',
      'No shadows on the face or background.',
      'Include a full face, front view, with both ears visible.',
    ],
  },
  {
    id: 'uk-35x45',
    label: 'UK Passport 35 × 45 mm',
    country: 'United Kingdom',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 29, max: 34 },
    eyeLineMmFromBottom: { min: 26, max: 32 },
    background: 'light-grey',
    notes: [
      'Head height must be 29–34 mm from chin to crown.',
      'Eyes should be between 26 mm and 32 mm from the bottom.',
      'Plain light grey or cream background, no patterns.',
      'Neutral expression and mouth closed.',
    ],
  },
  {
    id: 'schengen-35x45',
    label: 'Schengen Visa 35 × 45 mm',
    country: 'Schengen Area',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 32, max: 36 },
    eyeLineMmFromBottom: { min: 20, max: 28 },
    background: 'white',
    notes: [
      'Photo 35 × 45 mm with a light plain background.',
      'Face must occupy 70–80% of the photo (32–36 mm chin to crown).',
      'Leave 3–5 mm between the top of the head and the top edge.',
      'Taken within the last six months.',
    ],
  },
  {
    id: 'canada-50x70',
    label: 'Canada Passport 50 × 70 mm',
    country: 'Canada',
    widthMm: 50,
    heightMm: 70,
    dpi: 300,
    headHeightMm: { min: 31, max: 36 },
    eyeLineMmFromBottom: { min: 30, max: 40 },
    background: 'white',
    notes: [
      'Photo must be 50 × 70 mm with the face centred.',
      'Head height 31–36 mm from chin to crown.',
      'Plain white or light coloured background.',
      'Neutral expression and no shadows.',
    ],
  },
  {
    id: 'australia-35x45',
    label: 'Australia Passport 35 × 45 mm',
    country: 'Australia',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 32, max: 36 },
    eyeLineMmFromBottom: { min: 25, max: 30 },
    background: 'white',
    notes: [
      'Photo 35 × 45 mm with a plain white or light grey background.',
      'Head height 32–36 mm from chin to crown.',
      'Face the camera directly with a neutral expression.',
      'No glasses or headwear except for religious reasons.',
    ],
  },
  {
    id: 'china-33x48',
    label: 'China Passport 33 × 48 mm',
    country: 'China',
    widthMm: 33,
    heightMm: 48,
    dpi: 300,
    headHeightMm: { min: 28, max: 33 },
    eyeLineMmFromBottom: { min: 24, max: 30 },
    background: 'white',
    notes: [
      'Photo 33 × 48 mm with a plain white background.',
      'Head width 15–22 mm and head height 28–33 mm.',
      'Face the camera directly with a neutral expression.',
      'No hats or head coverings unless religious.',
    ],
  },
  {
    id: 'japan-35x45',
    label: 'Japan Passport 35 × 45 mm',
    country: 'Japan',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 30, max: 36 },
    eyeLineMmFromBottom: { min: 24, max: 30 },
    background: 'white',
    notes: [
      'Photo 35 × 45 mm with a plain white background.',
      'Head height should occupy roughly two thirds of the frame.',
      'Neutral expression, mouth closed and both eyes open.',
      'No hat or head covering except for religious reasons.',
    ],
  },
  {
    id: 'oci-51x51',
    label: 'India OCI 51 × 51 mm',
    country: 'India',
    widthMm: 51,
    heightMm: 51,
    dpi: 300,
    headHeightMm: { min: 25, max: 35 },
    eyeLineMmFromBottom: { min: 28, max: 34 },
    background: 'white',
    notes: [
      'OCI card photo 51 × 51 mm (2 × 2 in).',
      'Plain white background with the face centred.',
      'Neutral expression with both eyes open.',
      'No shadows on the face or background.',
    ],
  },
  {
    id: 'generic-35x45',
    label: 'Generic ID 35 × 45 mm',
    country: 'Any',
    widthMm: 35,
    heightMm: 45,
    dpi: 300,
    headHeightMm: { min: 29, max: 34 },
    eyeLineMmFromBottom: { min: 25, max: 31 },
    background: 'any',
    notes: [
      'Generic 35 × 45 mm ID photo with a plain background.',
      'Face the camera directly with a neutral expression.',
      'Head height 29–34 mm from chin to crown.',
      'No glasses, hats or heavy shadows.',
    ],
  },
]

export function getSpec(id: string): PassportSpec | undefined {
  return PASSPORT_SPECS.find((spec) => spec.id === id)
}

/**
 * The flat colour to composite for a spec's background, or null when the spec
 * accepts any backdrop and the document's own should be left alone. The grey is
 * the one the compliance rule accepts: `#f2f2f2` scores as plain light grey,
 * where the old value sat inside the warn band on its own rule.
 */
export function specBackgroundColor(spec: PassportSpec): string | null {
  if (spec.background === 'white') return '#ffffff'
  if (spec.background === 'light-grey') return '#f2f2f2'
  return null
}
