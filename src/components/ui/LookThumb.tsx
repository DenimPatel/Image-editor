import { useState } from 'react'

import { lookThumbUrl } from './lookThumbUrl'
import styles from './lookThumb.module.css'

/**
 * The Filters grid's half-built affordance, finished.
 *
 * A look is the least technical decision this product asks for — *how should
 * this photo look?* — and it was being made by reading a word out of a 52px
 * box. `src/gl/luts.ts` carries `{ id, label, family }` and no colour data at
 * all, but the grade itself is a pure function (`grade()` in
 * `scripts/lut-looks.mjs`), so the preview does not have to be a photograph of
 * anything: `scripts/gen-look-thumbs.mjs` grades one fixed synthetic scene —
 * sky, sun, treeline, a lit portrait, green foliage, red berries — 24 times and
 * commits the result. Every chip is the same picture through a different grade,
 * which is the only reason two of them can be compared.
 *
 * The thumbnails are committed rather than generated at build time, for the
 * reasons `scripts/gen-luts.mjs` sets out; `assets:check` byte-compares them so
 * a recipe edit that was not regenerated fails the build.
 */

/** The natural size of the committed PNGs, for the `width`/`height` pair that reserves the box. */
const NATURAL = { width: 144, height: 96 } as const

export function LookThumb({
  id,
  label,
  selected,
}: {
  id: string
  label: string
  selected: boolean
}) {
  // A thumbnail that fails to load must leave the chip exactly as it is today:
  // a text-only button. Not a broken-image box, not a chip with a hole in it,
  // and not an alt-text-sized label. Dropping the element outright is the only
  // outcome that needs no CSS to look right in all three themes, and it is why
  // the frame is a sibling of the label rather than a background of the button.
  const [failed, setFailed] = useState(false)
  if (failed) return null

  return (
    <span className={`${styles.frame}${selected ? ` ${styles.frameSelected}` : ''}`}>
      <img
        className={styles.thumb}
        src={lookThumbUrl(id)}
        // Names the look, so the markup says what it is showing rather than
        // carrying an anonymous picture beside a label that already says it.
        // The button pins its own accessible name with `aria-label`, so the chip
        // is still announced as exactly "Portra" — not "Portra Portra look
        // preview", which is what name-from-content would make of this.
        alt={`${label} look preview`}
        width={NATURAL.width}
        height={NATURAL.height}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
      {/* The selected state is a shape, not a colour: the chip also gets a ring
          and an `aria-pressed`, but a chip that reads as chosen only because
          its border went green is invisible to anyone who cannot separate those
          two greens. */}
      <span className={`${styles.tick}${selected ? ` ${styles.tickOn}` : ''}`} aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 10 10" focusable="false" aria-hidden="true">
          <path
            d="M1.6 5.2 3.9 7.5 8.4 2.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  )
}
