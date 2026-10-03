import { useId } from 'react'
import type { ReactNode } from 'react'
import styles from './emptyState.module.css'

/**
 * The one empty state for the whole editor.
 *
 * It used to be three voices under two component names: this file's own
 * `title`/`description` pair, a *second* `EmptyState` declared inside
 * `LayerPanels.tsx` with a `copy` prop and one bare paragraph, and `DrawPanel`'s
 * `<p className={styles.hint}>` with a button under it. Four panels — Text,
 * Redact, Frame, Layers — got the second one, Retouch and `ToolSurface` got the
 * first, and Draw had the third, so "nothing here yet" was rendered three ways
 * in one product. Two components with one name is the worst of both: a rename
 * fixes one of them and a reader still sees two designs.
 *
 * The shared shape is a labelled group rather than a landmark, because the sheet
 * around it is already a labelled dialog: a `role="region"` here would add a
 * peer of `main` to the landmarks rotor, thirteen times over. The title is an
 * `h3` inside it and is the *only* place the word appears, so nothing announces
 * it twice.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  /** The one word for what would be here: `Layers`, `Text`, `Draw`. */
  title: string
  /**
   * The explanation, as nodes rather than a string, because two of the five call
   * sites need more than one sentence and a `string` prop is the reason they had
   * a private component.
   */
  description: ReactNode
  /** The way out, when there is one. Stays focusable and stays the caller's. */
  action?: ReactNode
  /** Additive: the module's own class is always kept. */
  className?: string
}) {
  const titleId = useId()
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={className ? `${styles.empty} ${className}` : styles.empty}
    >
      <h3 id={titleId} className={styles.emptyTitle}>
        {title}
      </h3>
      <div className={styles.emptyBody}>{description}</div>
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  )
}
