import { useState } from 'react'
import { retentionLine, resumeFacts } from './resumeSummary'
import styles from './editor.module.css'
import copy from './onboarding.module.css'

export type ResumeSessionCardProps = {
  thumbnailUrl: string | null
  updatedAt: number
  /**
   * The stored document, exactly as it came off disk. Untrusted on purpose —
   * `resumeSummary` narrows every field it reads and reports nothing for a shape
   * it cannot read, so a session written by an older build renders a smaller
   * card rather than no card at all.
   */
  doc?: unknown
  onResume: () => void
  onDiscard: () => void
}

/**
 * "Continue editing?" — offered, but now decidable.
 *
 * The card used to show a thumbnail, the word "Continue editing?", and a
 * timestamp formatted for a machine, which made accepting or discarding a guess
 * and discarding a permanent one. It now shows the photo's own dimensions, how
 * many things have been changed in it, how long ago it was saved, and what the
 * retention horizon is going to do to it — the four facts a person needs before
 * throwing away work they cannot see.
 */
export function ResumeSessionCard({
  thumbnailUrl,
  updatedAt,
  doc,
  onResume,
  onDiscard,
}: ResumeSessionCardProps) {
  // The clock is read once, on mount, and never again. A card left open across
  // a rounding boundary would otherwise change its own wording under the user's
  // cursor, which reads as the app correcting itself rather than as time passing
  // — and reading it during render rather than in the initialiser is what makes
  // it change every time an unrelated prop does.
  const [now] = useState(() => Date.now())

  return (
    <div className={styles.resumeCard}>
      {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : null}
      <div className={copy.resumeBody}>
        <p className={copy.resumeTitle}>Continue editing?</p>
        <p className={copy.resumeFacts} title={new Date(updatedAt).toLocaleString()}>
          {resumeFacts(doc, updatedAt, now)}
        </p>
        <p className={copy.resumeRetention}>{retentionLine(updatedAt, now)}</p>
        <div className={copy.resumeActions}>
          <button type="button" className={styles.primaryButton} onClick={onResume}>
            Resume
          </button>
          <button type="button" className={styles.doneButton} onClick={onDiscard}>
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}
