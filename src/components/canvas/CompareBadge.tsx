import styles from './canvas.module.css';

export function CompareBadge() {
  return (
    <div className={styles.compareBadge} role="status" aria-live="polite">
      Original
    </div>
  );
}
