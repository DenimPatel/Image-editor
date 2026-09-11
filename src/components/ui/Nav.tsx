import { Button } from './Button';
import { ThemeToggle } from './ThemeToggle';

type NavProps = {
  variant: 'hub' | 'editor';
};

export function Nav({ variant }: NavProps) {
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <span className="brand">
          🎨 Image Editor<span className="brand__dot">.</span>
        </span>
        <div className="nav-actions">
          <ThemeToggle />
          {variant === 'hub' ? (
            <Button as="link" to="/editor" variant="primary" className="nav-cta">
              Open Editor
            </Button>
          ) : (
            <Button as="link" to="/" variant="ghost" className="nav-cta">
              ← Hub
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
