import type { CSSProperties } from 'react';
import type { SafeAreaPreset } from '../../store/uiStore';
import styles from './canvas.module.css';

type Insets = { top: number; right: number; bottom: number; left: number };

const INSETS: Record<Exclude<SafeAreaPreset, 'none'>, Insets> = {
  story: { top: 14, right: 6, bottom: 20, left: 6 },
  reel: { top: 10, right: 8, bottom: 26, left: 8 },
  youtube: { top: 5, right: 5, bottom: 5, left: 5 },
};

export function SafeAreaOverlay({ preset }: { preset: SafeAreaPreset }) {
  if (preset === 'none') return null;
  const insets = INSETS[preset];
  const style: CSSProperties = {
    top: `${insets.top}%`,
    right: `${insets.right}%`,
    bottom: `${insets.bottom}%`,
    left: `${insets.left}%`,
  };
  return (
    <div className={`${styles.safeArea}`} style={style} aria-hidden="true">
      <span className={styles.safeAreaLabel}>{preset} safe area</span>
    </div>
  );
}
