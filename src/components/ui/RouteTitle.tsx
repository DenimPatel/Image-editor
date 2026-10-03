import { useEffect } from 'react'
import type { ReactNode } from 'react'

export const DEFAULT_TITLE = 'Interactive Image Editor'

/**
 * Per-route `document.title`. `index.html` can only set one title, so the Hub
 * and the Editor used to share it — a browser with six tabs open showed the
 * same name six times and a screen-reader user got no page context.
 *
 * A wrapper element rather than a hook call inside `Hub`/`Editor` because the
 * route table owns the title and the pages do not.
 */
export function RouteTitle({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = title
  }, [title])
  return <>{children}</>
}
