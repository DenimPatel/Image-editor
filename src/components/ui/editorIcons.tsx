import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

function icon(paths: ReactNode) {
  return function Icon({ className, ...rest }: IconProps) {
    return (
      <svg {...base} {...rest} className={className}>
        {paths}
      </svg>
    );
  };
}

export const AdjustGlyph = icon(
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
);

export const FilterGlyph = icon(
  <>
    <circle cx="9" cy="9" r="5" />
    <circle cx="15" cy="15" r="5" />
  </>,
);

export const RetouchGlyph = icon(
  <>
    <path d="M12 3l1.9 3.9L18 8.5l-3 3 .7 4.3L12 14l-3.7 1.8.7-4.3-3-3 4.1-1.6z" />
  </>,
);

export const BackgroundGlyph = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </>,
);

export const TextGlyph = icon(
  <>
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </>,
);

export const DrawGlyph = icon(
  <>
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </>,
);

export const StickerGlyph = icon(
  <>
    <path d="M20 12a8 8 0 1 1-8-8 4 4 0 0 0 4 4h4z" />
    <circle cx="9" cy="11" r="1" />
    <circle cx="15" cy="11" r="1" />
  </>,
);

export const RedactGlyph = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="6" y="10" width="12" height="4" fill="currentColor" stroke="none" />
  </>,
);

export const FrameGlyph = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="7" y="7" width="10" height="10" rx="1" />
  </>,
);

export const LayersGlyph = icon(
  <>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </>,
);

export const PassportGlyph = icon(
  <>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <circle cx="12" cy="10" r="3" />
    <path d="M8 18h8" />
  </>,
);

export const ExportGlyph = icon(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </>,
);

export const UndoGlyph = icon(
  <>
    <polyline points="9 14 4 9 9 4" />
    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </>,
);

export const RedoGlyph = icon(
  <>
    <polyline points="15 14 20 9 15 4" />
    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
  </>,
);

export const MoreGlyph = icon(
  <>
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" />
  </>,
);

export const CheckGlyph = icon(<polyline points="20 6 9 17 4 12" />);
export const CloseGlyph = icon(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>,
);
export const PlusGlyph = icon(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>,
);
export const TrashGlyph = icon(
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </>,
);
export const EyeGlyph = icon(
  <>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const EyeOffGlyph = icon(
  <>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </>,
);
export const ChevronLeftGlyph = icon(<polyline points="15 18 9 12 15 6" />);
export const ChevronRightGlyph = icon(<polyline points="9 18 15 12 9 6" />);
export const FlipHorizontalGlyph = icon(
  <>
    <line x1="12" y1="3" x2="12" y2="21" />
    <path d="M16 7l5 5-5 5" />
    <path d="M8 7l-5 5 5 5" />
  </>,
);
export const GridGlyph = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </>,
);
export const ShareGlyph = icon(
  <>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
    <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
  </>,
);
export const InfoGlyph = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <line x1="12" y1="8" x2="12" y2="8" />
  </>,
);
export const SparkleGlyph = icon(
  <>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M18 18l-2-2M18 6l-2 2M6 18l2-2" />
  </>,
);
export const StraightenGlyph = icon(
  <>
    <line x1="3" y1="12" x2="21" y2="12" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <path d="M12 12l7-5" />
  </>,
);
export const CompareGlyph = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="12" y1="2" x2="12" y2="22" />
    <path d="M9 8L6 12l3 4" />
    <path d="M15 8l3 4-3 4" />
  </>,
);