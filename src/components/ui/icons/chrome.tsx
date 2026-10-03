import { icon } from './base'

/**
 * Editor chrome: the marks that are not a tool, not an adjustment and not an
 * action, but the furniture around them.
 *
 * `UndoGlyph`/`RedoGlyph` are here and only here. They were doing double duty
 * as rotate-left/rotate-right in the crop panel, which meant the same arrow was
 * "take this back" in the top bar and "turn the picture 90°" forty pixels away;
 * the rotation pair now lives in `./cropActions` under its own names.
 */
export const CloseGlyph = icon(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>,
)

export const CheckGlyph = icon(<polyline points="20 6 9 17 4 12" />)

export const PlusGlyph = icon(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>,
)

export const TrashGlyph = icon(
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </>,
)

export const EyeGlyph = icon(
  <>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </>,
)

export const EyeOffGlyph = icon(
  <>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </>,
)

export const ChevronLeftGlyph = icon(<polyline points="15 18 9 12 15 6" />)
export const ChevronRightGlyph = icon(<polyline points="9 18 15 12 9 6" />)

export const MoreGlyph = icon(
  <>
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" />
  </>,
)

export const InfoGlyph = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <line x1="12" y1="8" x2="12" y2="8" />
  </>,
)

export const SparkleGlyph = icon(
  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M18 18l-2-2M18 6l-2 2M6 18l2-2" />,
)

export const CompareGlyph = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="12" y1="2" x2="12" y2="22" />
    <path d="M9 8L6 12l3 4" />
    <path d="M15 8l3 4-3 4" />
  </>,
)

export const StraightenGlyph = icon(
  <>
    <line x1="3" y1="12" x2="21" y2="12" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <path d="M12 12l7-5" />
  </>,
)

export const FlipHorizontalGlyph = icon(
  <>
    <line x1="12" y1="3" x2="12" y2="21" />
    <path d="M16 7l5 5-5 5" />
    <path d="M8 7l-5 5 5 5" />
  </>,
)

export const UndoGlyph = icon(
  <>
    <polyline points="9 14 4 9 9 4" />
    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </>,
)

export const RedoGlyph = icon(
  <>
    <polyline points="15 14 20 9 15 4" />
    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
  </>,
)

export const SunGlyph = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2" x2="12" y2="4" />
    <line x1="12" y1="20" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
    <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="4" y2="12" />
    <line x1="20" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
    <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
  </>,
)

export const MoonGlyph = icon(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />)

export const WorkspaceGlyph = icon(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </>,
)

export const ArrowRightGlyph = icon(
  <>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </>,
)

/**
 * Play and pause, for the appearance panel's "Motion" group.
 *
 * The panel's rule is that every option previews itself, and this pair is the
 * whole idiom for the setting: a triangle for movement allowed, two bars for
 * movement stopped. It is also the one preview that must *not* move — a control
 * that demonstrates "reduced motion" by animating is the one control a reader
 * who chose it cannot use, and it is the only setting in the panel whose whole
 * point is that nothing moves.
 */
export const PlayGlyph = icon(<path d="M8 5l11 7-11 7z" />)

export const PauseGlyph = icon(
  <>
    <rect x="7" y="5" width="3.6" height="14" rx="1" />
    <rect x="13.4" y="5" width="3.6" height="14" rx="1" />
  </>,
)

/**
 * The three marks the overflow menu was missing.
 *
 * The menu is the one surface in the app whose rows carried no glyph at all, and the
 * audit's word for it was "seven ungrouped rows and no icons". A menu with a mark on
 * every row is findable at a glance; a menu of words is a reading task. Each of these
 * three names a row for which no mark existed in the system — a keyboard, a clipboard,
 * a save — and each is drawn from the shared base so it cannot drift from the other
 * ninety-seven. `icons.test.tsx` hashes the artwork and fails on a duplicate, so none
 * of the three can quietly become a second copy of an existing glyph.
 */

/** A board with three rows of keys and a space bar: the shortcut table. */
export const KeyboardGlyph = icon(
  <>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <line x1="6" y1="10" x2="6" y2="10" />
    <line x1="9.5" y1="10" x2="9.5" y2="10" />
    <line x1="13" y1="10" x2="13" y2="10" />
    <line x1="16.5" y1="10" x2="16.5" y2="10" />
    <line x1="7" y1="14" x2="17" y2="14" />
  </>,
)

/** A board with a tab at the top: "put this on the clipboard". */
export const PasteGlyph = icon(
  <>
    <path d="M9 4.5H7.5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2H15" />
    <rect x="9" y="2.5" width="6" height="4" rx="1" />
  </>,
)

/**
 * A disk with a shutter across its top edge.
 *
 * Deliberately *not* `DownloadGlyph`'s arrow into a tray: that arrow means "this file
 * leaves the browser", which is the export panel's claim, and reusing it here would
 * make "Save preset…" read as "Export preset…" — the same shape meaning two things,
 * which is the failure this directory's signature test exists to prevent.
 */
export const SaveGlyph = icon(
  <>
    <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M8 4v5h7V4" />
    <rect x="8" y="13" width="8" height="6" rx="1" />
  </>,
)
