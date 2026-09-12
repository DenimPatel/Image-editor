import styles from './editor.module.css';

export type ResumeSessionCardProps = {
  thumbnailUrl: string | null;
  updatedAt: number;
  onResume: () => void;
  onDiscard: () => void;
};

export function ResumeSessionCard({ thumbnailUrl, updatedAt, onResume, onDiscard }: ResumeSessionCardProps) {
  const when = new Date(updatedAt).toLocaleString();
  return (
    <div className={styles.resumeCard}>
      {thumbnailUrl && <img src={thumbnailUrl} alt="" />}
      <div style={{ flex: 1 }}>
        <p>Continue editing?</p>
        <p>{when}</p>
      </div>
      <button type="button" className={styles.primaryButton} onClick={onResume}>
        Resume
      </button>
      <button type="button" className={styles.doneButton} onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}
