import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Nav } from '../components/ui/Nav';
import { Button } from '../components/ui/Button';
import { IconTile } from '../components/ui/IconTile';
import { AdjustIcon, ArrowRightIcon, CropIcon, ExportIcon, RotateIcon, WorkspaceIcon } from '../components/ui/icons';

type Tool = {
  to: string;
  title: string;
  copy: string;
  Icon: typeof CropIcon;
  featured?: boolean;
};

const TOOLS: Tool[] = [
  {
    to: '/editor/crop',
    title: 'Crop & Straighten',
    copy: 'Crop to any ratio, straighten, and rotate with precision.',
    Icon: CropIcon,
  },
  {
    to: '/editor/adjust',
    title: 'Adjust',
    copy: 'Fine-tune brightness, contrast, and saturation live.',
    Icon: AdjustIcon,
  },
  {
    to: '/editor/transform',
    title: 'Flip & Rotate',
    copy: 'Flip horizontally or vertically, or rotate to any angle.',
    Icon: RotateIcon,
  },
  {
    to: '/editor/export',
    title: 'Resize & Export',
    copy: 'Export as JPEG, PNG, WebP, or PDF at any width and quality.',
    Icon: ExportIcon,
  },
  {
    to: '/editor',
    title: 'Open Full Editor',
    copy: 'Everything in one workspace — every tool, all at once.',
    Icon: WorkspaceIcon,
    featured: true,
  },
];

export default function Hub() {
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = revealRef.current;
    if (!root) return;
    const targets = root.querySelectorAll('.reveal');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={revealRef}>
      <Nav variant="hub" />

      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="wrap hero-inner">
          <span className="status-pill">
            <span className="status-dot" aria-hidden="true" /> 100% client-side — your images never leave this tab
          </span>
          <h1>Edit images, right in your browser</h1>
          <p className="lede">
            Crop, adjust, and export images entirely on your device — no uploads, no accounts, no waiting.
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
            <Link key={to} to={to} className={`tool-card reveal${featured ? ' tool-card--featured' : ''}`}>
              <IconTile>
                <Icon className="tool-card__icon" />
              </IconTile>
              <h3>{title}</h3>
              <p>{copy}</p>
              <span className="tool-card__link">
                {featured ? 'Open workspace' : 'Get started'} <ArrowRightIcon className="tool-card__arrow" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span>Interactive Image Editor</span>
          <span>Built with care.</span>
        </div>
      </footer>
    </div>
  );
}
