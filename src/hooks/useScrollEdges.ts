import { useEffect, useState, type RefObject } from 'react'

export type ScrollEdges = {
  /** There is more content than the box can show. */
  overflowing: boolean
  /** The leading edge is not yet showing, so a left fade would be honest. */
  beforeStart: boolean
  /** The trailing edge is already showing, so a right fade would be a lie. */
  afterEnd: boolean
}

const STILL: ScrollEdges = { overflowing: false, beforeStart: false, afterEnd: false }

/**
 * A scroller's two edges, in the one form an edge fade needs.
 *
 * `1` rather than `0` is the tolerance, and it is not a fudge: a row whose
 * content is a sub-pixel wider than its box is not overflowing in any sense a
 * person can see, and fading it says there is more when scrolling does nothing.
 */
export function measureScrollEdges(el: Element): ScrollEdges {
  const max = el.scrollWidth - el.clientWidth
  if (max <= 1) return STILL
  return { overflowing: true, beforeStart: el.scrollLeft > 1, afterEnd: el.scrollLeft >= max - 1 }
}

/**
 * Which of a horizontal scroller's two edges are worth fading.
 *
 * A row that scrolls sideways and hides its scrollbar reads as a layout bug
 * without a fade: the last item looks like the last item rather than like the
 * edge of a window. `ChipRowShell` needed this for its trailing edge and
 * re-declared the whole `ResizeObserver` to get it; `ToolTabBar` needs both
 * edges, and a second measurement would have been a change to the fade made in
 * two files, one of which is only correct until somebody checks the other.
 *
 * So the measurement lives here and the class names do not, because each bar
 * fades from its own stylesheet. `remeasure` is whatever invalidates the
 * numbers — `ChipRowShell` passes its children, `ToolTabBar` passes the tool
 * list — because a row whose content changes under a `ResizeObserver` that only
 * watches the row itself would keep the fade it had for the content it used to
 * hold.
 */
export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
  remeasure: unknown,
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(STILL)

  useEffect(() => {
    const row = ref.current
    if (!row) return
    const update = () => {
      const next = measureScrollEdges(row)
      // A scroll event fires per frame of a flick, and the answer rarely
      // changes; identity is what lets React skip the re-render.
      setEdges((prev) =>
        prev.overflowing === next.overflowing &&
        prev.beforeStart === next.beforeStart &&
        prev.afterEnd === next.afterEnd
          ? prev
          : next,
      )
    }
    update()
    // jsdom has no ResizeObserver, and a row that cannot measure itself must
    // still render — the fade is an affordance, not a precondition.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(row)
    for (const child of Array.from(row.children)) observer?.observe(child)
    if (!observer) window.addEventListener('resize', update)
    row.addEventListener('scroll', update, { passive: true })
    return () => {
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', update)
      row.removeEventListener('scroll', update)
    }
  }, [ref, remeasure])

  return edges
}
