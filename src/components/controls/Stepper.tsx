import styles from './controls.module.css';

export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next))));
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.stepper}>
        <button type="button" onClick={() => set(value - step)} aria-label={`Decrease ${label}`}>
          −
        </button>
        <span className={styles.stepperValue}>{value}</span>
        <button type="button" onClick={() => set(value + step)} aria-label={`Increase ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}
