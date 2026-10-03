/* eslint-disable react-refresh/only-export-components -- an icon module is a
   catalogue, not a stateful component tree: there is no hook state to lose on a hot
   reload, and splitting the lookups away from the marks they name would make the
   system harder to read, not easier. */
import type { ReactElement, ReactNode, SVGProps } from 'react'
import { signatureOf } from './signature'

/**
 * The one base every glyph in the app is drawn against.
 *
 * 24×24, a 2-unit round stroke, no fill, `currentColor`, and deliberately **no
 * `width`/`height`**: an SVG that carries intrinsic size ignores the CSS that
 * sizes it, so a hard-coded `width="24"` wins over `.tab svg { width: 22px }`
 * and every icon in the system is a different optical size depending on which
 * stylesheet reached it last. Size belongs to CSS; these carry shape.
 */
export const ICON_BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export type IconProps = SVGProps<SVGSVGElement>

/** A glyph is a plain function component with its artwork signature attached. */
export type IconComponent = ((props: IconProps) => ReactElement) & {
  /** Canonical serialisation of the artwork — the dedupe key. See `signature.ts`. */
  readonly signature: string
}

/**
 * `aria-hidden` by default, because a decorative glyph next to a text label is
 * announced twice and a glyph inside an `aria-label`ed button is announced
 * three times. Pass `aria-label` and the glyph becomes the accessible name of a
 * `role="img"` instead, so both states are reachable from the call site and
 * neither is the default-by-accident.
 */
function splitProps(props: IconProps) {
  const { className, role, 'aria-label': label, 'aria-hidden': hidden, ...rest } = props
  return {
    rest,
    access: {
      className,
      role: role ?? (label === undefined ? undefined : 'img'),
      'aria-hidden': hidden ?? (label === undefined ? true : undefined),
      'aria-label': label,
    },
  }
}

export function icon(paths: ReactNode): IconComponent {
  const Glyph = (props: IconProps) => {
    const { rest, access } = splitProps(props)
    return (
      <svg {...ICON_BASE} {...rest} {...access}>
        {paths}
      </svg>
    )
  }
  Glyph.signature = signatureOf(paths)
  return Glyph
}

/**
 * The same wrapper, for the one glyph whose artwork depends on a prop — the
 * aspect-ratio viewfinder, whose internal bars have to sit at the true
 * fractional positions of whatever ratio it was handed. Its signature is
 * deliberately not part of the dedupe set: it is not a fixed shape, and
 * `LandscapeRatioGlyph` *is* this glyph at 16:9.
 */
export function iconWith<P extends object>(build: (props: IconProps & P) => ReactNode) {
  return function ParameterisedIcon(props: IconProps & P) {
    const { rest, access } = splitProps(props)
    return (
      <svg {...ICON_BASE} {...rest} {...access}>
        {build(props)}
      </svg>
    )
  }
}
