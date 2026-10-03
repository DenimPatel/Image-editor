import type { NormRect } from '../../model/types'
import { guideLayout } from '../../features/passport/guides'
import { getSpec } from '../../features/passport/specs'
import canvasStyles from './canvas.module.css'
import styles from './passportGuides.module.css'

const FULL: NormRect = { x: 0, y: 0, width: 1, height: 1 }

/**
 * Advisory head/eye guides over the passport frame.
 *
 * `crop` is the rect the guides are drawn against: the spec's fractions are
 * relative to the passport photo, so the overlay is positioned over the crop
 * box and its own lines are percentages of that box. Without it the guides
 * were percentages of the whole image and every line sat at the wrong height
 * (D5-F10) — `CropOverlay` passes the crop, so the fix is one prop.
 */
export function PassportGuides({ specId, crop = FULL }: { specId: string; crop?: NormRect }) {
  const spec = getSpec(specId)
  if (!spec) return null
  const layout = guideLayout(spec, crop)

  return (
    <div
      className={canvasStyles.guides}
      style={{
        left: `${crop.x * 100}%`,
        top: `${crop.y * 100}%`,
        width: `${crop.width * 100}%`,
        height: `${crop.height * 100}%`,
        right: 'auto',
        bottom: 'auto',
      }}
      aria-hidden="true"
    >
      <div
        className={styles.headBand}
        style={{ top: `${layout.band.fromTop * 100}%`, height: `${layout.band.height * 100}%` }}
      />
      {layout.lines.map((line) => (
        <div
          key={line.id}
          className={line.kind === 'advisory' ? styles.eyeAdvisory : styles.eyeBound}
          style={{ top: `${line.fromTop * 100}%` }}
        >
          <span className={line.kind === 'advisory' ? styles.label : styles.boundLabel}>
            {line.label}
          </span>
        </div>
      ))}
      {layout.warning ? <span className={styles.warning}>{layout.warning}</span> : null}
    </div>
  )
}
