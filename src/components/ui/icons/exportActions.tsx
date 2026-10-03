import { icon } from './base'

/**
 * What the export sheet actually *does*.
 *
 * Five buttons in one row — Download, Share, Copy, Multi-size zip, Cancel — and
 * until now not one of them had a mark. The sheet's button that performs the
 * export carried no icon at all, while `ExportIcon`/`ExportGlyph` (one shape,
 * two names) sat on the Hub card for the tool nobody had reached yet.
 *
 * The distinction that matters is Download vs Copy vs Share, so they are three
 * different objects: a file landing in a tray, a duplicate sheet, a node
 * fanning out to two others.
 */
export const DownloadGlyph = icon(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </>,
)

export const ShareGlyph = icon(
  <>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
    <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
  </>,
)

/** Two sheets, the back one showing through the gap the front one leaves. */
export const CopyGlyph = icon(
  <>
    <rect x="8.5" y="3.5" width="12" height="12" rx="2" />
    <path d="M15.5 18.5v.5a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h.5" />
  </>,
)

/** A box with a lid seam and a pull tab: the multi-size zip. */
export const ArchiveGlyph = icon(
  <>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <line x1="3" y1="9.5" x2="21" y2="9.5" />
    <rect x="9" y="6" width="6" height="5" rx="1" fill="currentColor" stroke="none" />
  </>,
)

/** A cross in a ring — "stop this", not the bare ✕ that means "dismiss". */
export const CancelGlyph = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </>,
)
