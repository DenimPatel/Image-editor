import { useRef, useState } from 'react'
import { hslToRgb } from '../../lib/hsl'
import { rgbToHex } from '../../lib/curves'
import { HSL_BANDS } from '../../model/defaults'
import type { HslBand } from '../../model/types'
import { setHslBand } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { Slider } from '../controls/Slider'
import { nextRovingIndex } from '../ui/rovingTabindex'
import styles from './adjust.module.css'
import toolStyles from './tools.module.css'

/**
 * The middle hue of each band, in degrees.
 *
 * Read straight off `hueToBand` in `src/lib/hsl.ts` and `bandFor` in
 * `HSL_FRAG`: red is the one band that wraps, so it is 345°..15° and its middle
 * is 0°, not 360°. The two functions and this table are three copies of one
 * boundary list, and `hsl.test.ts` pins the other two — so if a boundary moves,
 * this table is the copy that stops being about the same hue and the swatch
 * starts lying about the band it is labelling.
 */
const BAND_CENTER_HUE: Record<HslBand, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 230,
  purple: 290,
  magenta: 330,
}

/** Enough chroma to read as the colour, and the same lightness for every band. */
const SWATCH_SATURATION = 0.66
const SWATCH_LIGHTNESS = 0.52

/**
 * The band name a user reads, and the swatch that maps it onto pixels.
 *
 * The swatch is sampled from the band's own hue rather than picked by eye, so
 * "Blue" cannot be swatched green: the only thing a reader has to trust is the
 * number the shader already uses.
 */
function bandSwatch(band: HslBand): string {
  const { r, g, b } = hslToRgb(BAND_CENTER_HUE[band], SWATCH_SATURATION, SWATCH_LIGHTNESS)
  return rgbToHex(r, g, b)
}

function bandLabel(band: HslBand): string {
  return band[0].toUpperCase() + band.slice(1)
}

function isEdited(values: { hue: number; sat: number; lum: number }): boolean {
  return values.hue !== 0 || values.sat !== 0 || values.lum !== 0
}

/**
 * Eight named bands, three targets each. The model is 24 numbers keyed by
 * *colour*, which is the thing the panel is for, so nothing here is renamed:
 * `HSL_BANDS`, `HslBand` and `hsl` are the on-disk contract and they stay.
 *
 * What the panel does *not* do any more is hide that model behind a single
 * eight-way segmented control. Eight equal buttons in one row is a row of
 * unreadable slivers at 390px, and it says nothing about the one thing a user
 * editing colour needs to know: which bands they have already touched. So the
 * bands are a wrapping grid of chips — name, swatch, pressed state — and the
 * three sliders below name the band they edit.
 */
export function HslPanel() {
  const hsl = useDocStore((state) => state.present.hsl)
  const [band, setBand] = useState<HslBand>('red')
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([])
  const value = hsl[band]

  return (
    <div>
      <div
        className={styles.bandGrid}
        role="group"
        aria-label="Colour bands"
        onKeyDown={(event) => {
          const index = HSL_BANDS.indexOf(band)
          // `both`, not `horizontal`: the grid wraps, so a down-arrow that moved
          // along the row would send the selection somewhere the eye has to hunt
          // for. Wrapping is still the right behaviour at the ends.
          const next = nextRovingIndex(event.key, index, HSL_BANDS.length, 'both')
          if (next === null) return
          event.preventDefault()
          const target = HSL_BANDS[next]
          setBand(target)
          chipRefs.current[next]?.focus()
        }}
      >
        {HSL_BANDS.map((candidate, index) => {
          const selected = candidate === band
          return (
            <button
              key={candidate}
              ref={(node) => {
                chipRefs.current[index] = node
              }}
              type="button"
              // The dot is `aria-hidden` and carries no text, so the button's
              // accessible name is the band name and nothing else — a screen
              // reader is not told "Red red" or handed a colour string instead
              // of the band it names.
              className={`${styles.bandChip}${selected ? ` ${styles.bandChipActive}` : ''}`}
              aria-pressed={selected}
              data-edited={isEdited(hsl[candidate]) ? 'true' : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => setBand(candidate)}
            >
              <span
                className={styles.bandSwatch}
                style={{ background: bandSwatch(candidate) }}
                aria-hidden="true"
              />
              {bandLabel(candidate)}
            </button>
          )
        })}
      </div>

      <div className={styles.bandSliders}>
        <Slider
          label="Hue"
          value={value.hue}
          min={-30}
          max={30}
          unit="°"
          interactionKey={`hsl:${band}:hue`}
          onChange={(hue) => setHslBand(band, { hue })}
        />
        <Slider
          label="Saturation"
          value={value.sat}
          min={-100}
          max={100}
          unit="%"
          interactionKey={`hsl:${band}:sat`}
          onChange={(sat) => setHslBand(band, { sat })}
        />
        <Slider
          label="Lightness"
          value={value.lum}
          min={-100}
          max={100}
          unit="%"
          interactionKey={`hsl:${band}:lum`}
          onChange={(lum) => setHslBand(band, { lum })}
        />
      </div>

      <div className={toolStyles.buttonRow}>
        <button
          type="button"
          className={toolStyles.textButton}
          disabled={!isEdited(value)}
          onClick={() => setHslBand(band, { hue: 0, sat: 0, lum: 0 })}
        >
          Reset {bandLabel(band)}
        </button>
      </div>

      <p className={toolStyles.hint}>
        Editing the {bandLabel(band)} band. Bands are split by hue angle with no blending, so a
        colour that sits between two — the orange in a sunset, say — moves with both of them.
        Saturation and lightness are percentages of what that pixel already is, not absolute values:
        −100% saturation is grey, +100% doubles it.
      </p>
    </div>
  )
}
