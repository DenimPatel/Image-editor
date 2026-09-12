import { getSpec } from '../../features/passport/specs';
import styles from './canvas.module.css';

/**
 * Advisory head/eye guide lines over the crop frame. They show the required
 * eye line and head-height band for the selected passport spec so a user can
 * align a face manually when the landmark model is unavailable.
 */
export function PassportGuides({ specId }: { specId: string }) {
  const spec = getSpec(specId);
  if (!spec) return null;
  const eyeMid = (spec.eyeLineMmFromBottom.min + spec.eyeLineMmFromBottom.max) / 2;
  const headMid = (spec.headHeightMm.min + spec.headHeightMm.max) / 2;
  const eyeFromTop = 1 - eyeMid / spec.heightMm;
  const crownFromTop = Math.max(0, eyeFromTop - headMid / spec.heightMm);
  const eyeMaxFromTop = 1 - spec.eyeLineMmFromBottom.max / spec.heightMm;
  const eyeMinFromTop = 1 - spec.eyeLineMmFromBottom.min / spec.heightMm;

  return (
    <div className={styles.guides} aria-hidden="true">
      <div
        className={styles.guideBand}
        style={{ top: `${crownFromTop * 100}%`, height: `${(eyeFromTop - crownFromTop) * 100}%` }}
      />
      <div className={styles.guideLine} style={{ top: `${eyeFromTop * 100}%` }} />
      <div className={styles.guideLine} style={{ top: `${eyeMinFromTop * 100}%` }} />
      <div className={styles.guideLine} style={{ top: `${eyeMaxFromTop * 100}%` }} />
    </div>
  );
}
