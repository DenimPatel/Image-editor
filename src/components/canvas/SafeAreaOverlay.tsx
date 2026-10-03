import type { CSSProperties } from 'react'
import type { NormRect } from '../../model/types'
import type { SafeAreaPreset } from '../../store/uiStore'
import styles from './canvas.module.css'

type Insets = { top: number; right: number; bottom: number; left: number }

const INSETS: Record<Exclude<SafeAreaPreset, 'none'>, Insets> = {
  story: { top: 14, right: 6, bottom: 20, left: 6 },
  reel: { top: 10, right: 8, bottom: 26, left: 8 },
  youtube: { top: 5, right: 5, bottom: 5, left: 5 },
}

const FULL: NormRect = { x: 0, y: 0, width: 1, height: 1 }

/**
 * Platform safe-area guides. The insets are percentages of the frame that gets
 * exported, so they are drawn over the crop box rather than over the whole
 * image (D5-F10) — same wiring as `PassportGuides`, same `crop` prop.
 */
export function SafeAreaOverlay({
  preset,
  crop = FULL,
}: {
  preset: SafeAreaPreset
  crop?: NormRect
}) {
  if (preset === 'none') return null
  return (
    <div className={styles.safeArea} style={frameStyle(INSETS[preset], crop)} aria-hidden="true">
      <span className={styles.safeAreaLabel}>{preset} safe area</span>
    </div>
  )
}

/** The crop rect with a percentage inset on it, in percentages of the frame. */
function frameStyle(insets: Insets, crop: NormRect): CSSProperties {
  const left = crop.x + (insets.left / 100) * crop.width
  const top = crop.y + (insets.top / 100) * crop.height
  const width = ((100 - insets.left - insets.right) / 100) * crop.width
  const height = ((100 - insets.top - insets.bottom) / 100) * crop.height
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
    right: 'auto',
    bottom: 'auto',
  }
}
