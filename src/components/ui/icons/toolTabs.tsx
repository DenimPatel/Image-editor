import { icon } from './base'

/**
 * The tool-tab rail. One glyph per `ToolId`, each meaning exactly one tool.
 *
 * `AdjustToolGlyph` and `ExportToolGlyph` are the two that had to be redrawn
 * rather than renamed: the meter artwork used to exist twice (`AdjustIcon` and
 * `AdjustGlyph`, byte-identical) and the export artwork used to exist twice as
 * well, and — the actual defect — the *tool* glyph and the *action* glyph for
 * export were the same shape. `DownloadGlyph` in `./exportActions` is the
 * action; this one is the panel.
 */
export const CropToolGlyph = icon(
  <>
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </>,
)

export const AdjustToolGlyph = icon(
  <>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </>,
)

export const FilterToolGlyph = icon(
  <>
    <circle cx="9" cy="9" r="5" />
    <circle cx="15" cy="15" r="5" />
  </>,
)

export const RetouchToolGlyph = icon(
  <path d="M12 3l1.9 3.9L18 8.5l-3 3 .7 4.3L12 14l-3.7 1.8.7-4.3-3-3 4.1-1.6z" />,
)

export const BackgroundToolGlyph = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </>,
)

export const TextToolGlyph = icon(
  <>
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </>,
)

export const DrawToolGlyph = icon(
  <>
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </>,
)

export const StickerToolGlyph = icon(
  <>
    <path d="M20 12a8 8 0 1 1-8-8 4 4 0 0 0 4 4h4z" />
    <circle cx="9" cy="11" r="1" />
    <circle cx="15" cy="11" r="1" />
  </>,
)

export const RedactToolGlyph = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="6" y="10" width="12" height="4" fill="currentColor" stroke="none" />
  </>,
)

/** A mat band across the top and a picture behind it — a *frame*, not a border. */
export const FrameToolGlyph = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="5" y="5" width="14" height="3" fill="currentColor" stroke="none" />
    <line x1="5" y1="11" x2="19" y2="11" />
    <line x1="5" y1="14.5" x2="13" y2="14.5" />
  </>,
)

export const LayersToolGlyph = icon(
  <>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </>,
)

export const PassportToolGlyph = icon(
  <>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <circle cx="12" cy="10" r="3" />
    <path d="M8 18h8" />
  </>,
)

/** The image leaving the frame to the right. `DownloadGlyph` is the tray it lands in. */
export const ExportToolGlyph = icon(
  <>
    <rect x="2.5" y="5" width="13" height="14" rx="2" />
    <path d="M12 12h9" />
    <polyline points="18 9 21 12 18 15" />
  </>,
)
