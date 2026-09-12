import { useUiStore } from '../../store/uiStore';
import styles from './editor.module.css';

export function JobProgressBar() {
  const jobs = useUiStore((state) => state.jobs);
  const running = jobs.find((job) => job.status === 'running');
  if (!running) return null;
  return (
    <>
      <div className={styles.jobBar} role="progressbar" aria-valuenow={Math.round(running.progress * 100)}>
        <div className={styles.jobBarFill} style={{ width: `${Math.round(running.progress * 100)}%` }} />
      </div>
      <div className={styles.jobLabel} aria-live="polite">
        {running.label}
      </div>
    </>
  );
}
