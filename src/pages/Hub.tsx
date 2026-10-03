import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Nav } from '../components/ui/Nav'
import { Button } from '../components/ui/Button'
import { IconTile } from '../components/ui/IconTile'
import { buildLabel } from '../lib/buildInfo'
import { licencesSummary } from '../lib/licenses'
import {
  ArrowRightGlyph,
  AdjustToolGlyph,
  BackgroundToolGlyph,
  CropToolGlyph,
  ExportToolGlyph,
  FilterToolGlyph,
  LayersToolGlyph,
  PassportToolGlyph,
  WorkspaceGlyph,
  type IconComponent,
} from '../components/ui/icons'

/**
 * The skip link is off-screen until it takes focus, which is the whole point: a
 * keyboard user tabs onto it and it becomes the first thing on the page. The
 * reveal is a CSS `:focus` rule rather than React state so the link is already
 * in the right place on the first frame it is painted, and so the editor's skip
 * link can reuse exactly the same rule instead of a second copy of these styles.
 * `--ie-skip-top` clears the page's own header so the link never covers the
 * wordmark it just replaced in the tab order.
 */

type Tool = {
  to: string
  title: string
  copy: string
  Icon: IconComponent
  featured?: boolean
}

/**
 * The eight doors.
 *
 * `Hub.test.tsx` holds two invariants over this table, and both exist because the
 * table was wrong once:
 *
 * - Every `to` is a route the router really serves *and* a tool that really
 *   opens a panel. One of these cards pointed at `/editor/transform`, which is
 *   not a `ToolId`: `/editor/:tool` matches any string, the Editor only calls
 *   `setActiveTool` for a tool in `TOOL_IDS`, and a `transform` that is not one
 *   therefore landed the user with the photo loaded, no tab marked current and
 *   no sheet — a dead end reached by following the editor's own front page. The
 *   capability the card was advertising is real, but it is not a tool of its
 *   own: rotate-left, rotate-right and flip live on the **Crop** tool's button
 *   row (`CropPanel.tsx`), so the card now says so, on the card that opens them.
 * - Every `title` is a name the app uses. "Flip & Rotate" also promised a
 *   *vertical* flip, and there is no control for one anywhere: `toggleFlipV`
 *   exists in the store and no panel calls it. A card that advertises a control
 *   the app does not have is worse than a card that does not exist, so the copy
 *   is held to what a button can do.
 *
 * So the eighth slot went to **Looks**, which had no card at all: `filters` is a
 * real `ToolId` with a real panel, and its twenty-four looks are the first thing
 * in this editor anyone asks about. `Hub.test.tsx` drives every one of these
 * routes through the real router and asserts a panel opens, so the next card
 * added here cannot be another dead end.
 */
const TOOLS: Tool[] = [
  {
    to: '/editor/crop',
    title: 'Crop & Straighten',
    copy: 'Crop to any ratio, straighten, rotate or flip — with precision.',
    Icon: CropToolGlyph,
  },
  {
    to: '/editor/adjust',
    title: 'Adjust',
    copy: 'Fine-tune brightness, contrast, and saturation live.',
    Icon: AdjustToolGlyph,
  },
  {
    to: '/editor/filters',
    title: 'Looks',
    copy: 'Twenty-four film looks in four families, each with an amount you can dial.',
    Icon: FilterToolGlyph,
  },
  {
    to: '/editor/export',
    title: 'Resize & Export',
    copy: 'Export as JPEG, PNG, WebP or PDF at any size, DPI and quality — plus AVIF where your browser can encode it.',
    Icon: ExportToolGlyph,
  },
  {
    to: '/editor/passport',
    title: 'Passport Photos',
    copy: 'US, UK, Schengen and more — auto-framed, compliance-checked, printable sheets.',
    Icon: PassportToolGlyph,
  },
  {
    to: '/editor/background',
    title: 'Remove Background',
    copy: 'Cut out the subject and replace it with a colour, gradient or transparency.',
    Icon: BackgroundToolGlyph,
  },
  {
    to: '/editor/layers',
    title: 'Text & Layers',
    copy: 'Add text, stickers, drawings, redactions, watermarks and frames.',
    Icon: LayersToolGlyph,
  },
  {
    to: '/editor',
    title: 'Open Full Editor',
    copy: 'Everything in one workspace — every tool, all at once.',
    Icon: WorkspaceGlyph,
    featured: true,
  },
]

export default function Hub() {
  const revealRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = revealRef.current
    if (!root) return
    const targets = root.querySelectorAll('.reveal')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach((el) => el.classList.add('is-visible'))
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12 },
    )
    targets.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={revealRef} style={{ '--ie-skip-top': '60px' } as React.CSSProperties}>
      <a className="skipLink" href="#main">
        Skip to content
      </a>
      <Nav variant="hub" />

      <main id="main" tabIndex={-1}>
        <section className="hero">
          <div className="hero-grid" aria-hidden="true" />
          <div className="wrap hero-inner">
            <span className="status-pill">
              <span className="status-dot" aria-hidden="true" /> 100% client-side — your images are
              never uploaded
            </span>
            <h1>Edit images, right in your browser</h1>
            <p className="lede">
              Crop, adjust, and export images entirely on your device — no uploads, no accounts, no
              waiting.
            </p>
            <div className="hero-actions">
              <Button as="link" to="/editor" variant="primary">
                Start editing
              </Button>
              <Button as="link" to="#tools" variant="ghost">
                See what it can do
              </Button>
            </div>
          </div>
        </section>

        <section className="wrap tools-section" id="tools">
          <div className="section-head reveal">
            <span className="eyebrow">Tools</span>
            <h2>Pick a starting point</h2>
          </div>
          <div className="tool-grid">
            {TOOLS.map(({ to, title, copy, Icon, featured }) => (
              <Link
                key={to}
                to={to}
                className={`tool-card reveal${featured ? ' tool-card--featured' : ''}`}
              >
                <IconTile>
                  <Icon className="tool-card__icon" />
                </IconTile>
                <h3>{title}</h3>
                <p>{copy}</p>
                <span className="tool-card__link">
                  {featured ? 'Open workspace' : 'Get started'}{' '}
                  <ArrowRightGlyph className="tool-card__arrow" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span>Interactive Image Editor</span>
          <span>Built with care.</span>
          {/* The build identifier and the licences are the two things a bug
              report has to carry, and this is the only static chrome on the
              page that survives a user copying it. `buildLabel()` is stamped
              from package.json at compile time, so it cannot drift from the
              version the app was actually built at — the failure mode of the
              hardcoded `APP_VERSION` literal it replaced. The link is a plain
              anchor to a static file rather than a route: it has to work from
              the crash screen, where the router may be what broke. */}
          <span className="footer-meta">
            <a href={`${import.meta.env.BASE_URL}licenses.html`}>Licences and attribution</a>
            <span className="footer-counts">({licencesSummary()})</span>
            <span aria-hidden="true"> · </span>
            <span>{buildLabel()}</span>
          </span>
        </div>
      </footer>
    </div>
  )
}
