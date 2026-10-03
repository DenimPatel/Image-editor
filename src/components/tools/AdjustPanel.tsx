import { useState } from 'react'
import { ADJUST_SPECS } from '../../model/defaults'
import type { AdjustKey } from '../../model/types'
import { AUTO_ADJUST_KEYS } from '../../lib/auto'
import { displayUnit } from '../../lib/format'
import { DialSlider } from '../controls/DialSlider'
import { ParameterRow } from '../controls/ParameterRow'
import { SegmentedControl } from '../controls/SegmentedControl'
import { setAdjust } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { CurvesEditor } from './CurvesEditor'
import { Histogram } from './Histogram'
import { HslPanel } from './HslPanel'
import styles from './tools.module.css'

type Section = 'sliders' | 'curves' | 'hsl'

/**
 * What each adjustment actually does, for the two that cannot be told apart from
 * the number beside them.
 *
 * Both are an additive offset of the same size — `TONE_FRAG` runs
 * `c += u_brightness * 0.25` and then `c += u_brilliance * 0.25 * mid`, with
 * `mid` a pair of `smoothstep`s that peaks in the midtones and reaches zero by
 * 0.15 and 0.95. So the difference is entirely in *where* the offset lands, and
 * that is exactly what a label and a "0" cannot say. Kept to the two that need
 * it: a sentence under every one of the fifteen would be noise, and a tooltip
 * would be unread on a phone.
 */
const EXPLAINED: Partial<Record<AdjustKey, string>> = {
  brilliance:
    'The same offset as Brightness, weighted to the midtones — it falls away in the deepest shadows and in the brightest highlights.',
  brightness: 'A flat offset added to every pixel, shadows and highlights alike.',
}

const AUTO_LABEL = 'Auto tone'

/**
 * `title` for Auto, because a 9-character button cannot say what it touches.
 *
 * Auto reads the whole frame through every other edit already in the document
 * and then *rewrites* six sliders from it, so the two things a user has to be
 * told are what it sets and what it does not. It is not "auto for the selected
 * parameter", which is what the old bare `Auto` read as.
 */
const AUTO_TITLE = `Sets ${AUTO_ADJUST_KEYS.length} sliders from the whole photo as it stands now: Exposure, Brightness, Black Point, Contrast, Highlights and Shadows. Your other sliders, Curves and Colour bands are left alone, and the selected parameter is overwritten rather than filled in.`

export function AdjustPanel({
  source,
  onAuto,
}: {
  source: ImageBitmap | null
  onAuto?: () => void
}) {
  const adjust = useDocStore((state) => state.present.adjust)
  const selectedKey = useUiStore((state) => state.selectedAdjustKey)
  const selectKey = useUiStore((state) => state.selectAdjustKey)
  const [section, setSection] = useState<Section>('sliders')

  const spec = ADJUST_SPECS.find((candidate) => candidate.key === selectedKey) ?? ADJUST_SPECS[0]
  const items = ADJUST_SPECS.map((candidate) => ({
    key: candidate.key,
    label: candidate.label,
    value: adjust[candidate.key],
    min: candidate.min,
    max: candidate.max,
    neutral: candidate.neutral,
    unit: displayUnit(candidate.unit),
  }))

  return (
    <div>
      <Histogram source={source} />
      <SegmentedControl
        ariaLabel="Adjustment section"
        options={[
          { value: 'sliders', label: 'Sliders' },
          { value: 'curves', label: 'Curves' },
          { value: 'hsl', label: 'Colour bands' },
        ]}
        value={section}
        onChange={setSection}
      />

      {section === 'sliders' && (
        <>
          <ParameterRow
            items={items}
            selectedKey={spec.key}
            onSelect={(key: AdjustKey) => selectKey(key)}
          />
          <DialSlider
            label={spec.label}
            value={adjust[spec.key]}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            neutral={spec.neutral}
            unit={displayUnit(spec.unit)}
            onChange={(value) => setAdjust(spec.key, value)}
            onInteractionStart={() => useDocStore.getState().beginInteraction(`adjust:${spec.key}`)}
            onInteractionEnd={() => useDocStore.getState().endInteraction()}
          />
          {EXPLAINED[spec.key] && (
            <p className={styles.hint} data-adjust-explanation={spec.key}>
              {EXPLAINED[spec.key]}
            </p>
          )}
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => setAdjust(spec.key, spec.neutral)}
            >
              Reset {spec.label}
            </button>
            {onAuto && (
              <button
                type="button"
                className={`${styles.textButton} ${styles.textButtonPrimary}`}
                title={AUTO_TITLE}
                onClick={onAuto}
              >
                {AUTO_LABEL}
              </button>
            )}
          </div>
        </>
      )}

      {section === 'curves' && <CurvesEditor />}
      {section === 'hsl' && <HslPanel />}
    </div>
  )
}
