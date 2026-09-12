import styles from './controls.module.css';

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        type="color"
        className={styles.colorInput}
        value={value === 'transparent' ? '#ffffff' : value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
