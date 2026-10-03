import { useEffect, useRef, useState } from 'react'
import { LUT_PRESETS, loadLut } from '../../gl/luts'
import { setLook } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { Slider } from '../controls/Slider'
import { LookThumb } from '../ui/LookThumb'
import styles from './tools.module.css'

const FAMILIES = ['Film', 'Cinematic', 'Mono', 'Creative'] as const

/**
 * The one word for "how much of this effect".
 *
 * It used to be "Strength" here and "Strength" in the Redact panel as well, for
 * two unrelated numbers: how far a look has been dialled in, and how hard a
 * redaction bites. One word cannot mean two things in a product a first-time
 * user is reading for the first time, and the orientation panel had already
 * settled it — "a named bundle of adjustments … with an amount you can dial in
 * and out". So the word is `Amount` everywhere, and `src/lib/copy.ts` is what
 * keeps the second panel from spending it again.
 */
const AMOUNT = 'Amount'

export function FiltersPanel() {
  const look = useDocStore((state) => state.present.look)
  // `loadLut` rejects rather than resolving to `null`, because `LUT3D_FRAG` is
  // skipped when no LUT is resident: a silent failure left the chip highlighted
  // on a look that changed nothing at all.
  const [lutError, setLutError] = useState<string | null>(null)
  // …and a rejection still left that same chip highlighted, which is the same
  // lie one click later. `failed` is what the error actually did: the look is
  // still in the document, because the document is what was asked for, but
  // nothing is being applied, so the chip must not claim otherwise.
  const [failed, setFailed] = useState<string | null>(null)
  const applied = (id: string | null) => look.id === id && failed !== id

  /**
   * Put the applied look back on screen when the panel opens.
   *
   * Twenty-four looks in four families is about eleven hundred pixels of chips in
   * a scroller roughly eight hundred tall, so the sheet opens at the top — which
   * is the `LOOKS` / `None` row and the top of *Film*. A document with `Vivid` in
   * it, which is in *Creative* and therefore in the last screenful, reopened into
   * a panel that said nothing whatever about what was applied: no chip was lit,
   * no name was readable, and the photo on the canvas was the only evidence.
   *
   * `block: 'nearest'` is the whole of the behaviour: it scrolls the sheet's own
   * body and only when the chip is genuinely outside it, so picking a look that
   * is already visible moves nothing, and the page itself has nothing to scroll
   * because `.editor` is a fixed clipped frame.
   *
   * Two `?.`, for two different reasons, and both are load-bearing. The ref is
   * cleared between requesting the frame and running it — the look can change
   * again in between, and React detaches the ref from a chip that is no longer
   * the applied one — and the method is optional because jsdom implements no
   * `scrollIntoView` at all. Without the second one every look change threw
   * *inside a `requestAnimationFrame` callback*, which is the one place a thrown
   * error has no caller to reject: it surfaced as an unhandled error in the test
   * runner with a stack in a panel, and nowhere else. Scrolling into view is a
   * convenience; it must not be able to take the sheet down with it.
   */
  const appliedChip = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!look.id) return
    const frame = requestAnimationFrame(() => {
      appliedChip.current?.scrollIntoView?.({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [look.id])

  return (
    /* No heading of its own. `BottomSheet` has already written `Looks` at the
       top of the panel, and a second "Looks" ten pixels below it is the same
       word twice. The other eleven panels open on a *group* name — Shapes,
       Watermark, Transform, Brush — so this one opens on the first row a reader
       can act on, which is the family chips and the `None` they sit above. */
    <div>
      <button
        type="button"
        className={`${styles.lookItem}${applied(null) ? ` ${styles.lookItemActive}` : ''}`}
        style={{ width: '100%' }}
        aria-label="None"
        aria-pressed={look.id === null && failed === null}
        onClick={() => {
          setLutError(null)
          setFailed(null)
          setLook(null)
        }}
      >
        None
      </button>

      {FAMILIES.map((family) => (
        <div key={family}>
          <p className={styles.sectionTitle}>{family}</p>
          <div className={styles.lookGrid}>
            {LUT_PRESETS.filter((preset) => preset.family === family).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`${styles.lookItem}${applied(preset.id) ? ` ${styles.lookItemActive}` : ''}`}
                // The chip's accessible name is pinned to the label it had when
                // it was text only. The thumbnail's `alt` names the look too,
                // and without this a screen reader announces "Portra Portra
                // look preview" — which is not the name the e2e suite, the
                // focus order and the user's own memory agree on.
                aria-label={preset.label}
                aria-pressed={applied(preset.id)}
                ref={applied(preset.id) ? appliedChip : undefined}
                onClick={() => {
                  setLutError(null)
                  setFailed(null)
                  setLook(preset.id, look.amount || 1)
                  void loadLut(preset.id).catch((error: unknown) => {
                    setFailed(preset.id)
                    setLutError(
                      error instanceof Error
                        ? `${error.message}. The look is not applied.`
                        : `The "${preset.label}" look could not be loaded, so it is not applied.`,
                    )
                  })
                }}
              >
                <LookThumb id={preset.id} label={preset.label} selected={applied(preset.id)} />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {lutError && (
        <p role="status" className={styles.error}>
          {lutError}
        </p>
      )}

      {look.id && (
        <>
          {/* No `sectionTitle` above this slider. Every other panel in the app
              that has a section heading does not repeat it on the control —
              Adjust prints "Exposure" once, not "EXPOSURE" and then "Exposure" —
              and here both were on screen at once, stacked, for the one control
              a user is most likely to want right after picking a look. The
              slider carries its own label, so the heading was a second copy of
              the same word with nothing between them. */}
          <Slider
            label={AMOUNT}
            value={Math.round(look.amount * 100)}
            min={0}
            max={100}
            interactionKey="look:amount"
            onChange={(value) => setLook(look.id, value / 100)}
            unit="%"
          />
        </>
      )}
    </div>
  )
}
