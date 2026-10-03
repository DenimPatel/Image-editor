import { useAppearance } from '../../hooks/useAppearance'
import { AppearanceMenu } from './AppearanceMenu'
import { Button } from './Button'
import { ThemeToggle } from './ThemeToggle'

type NavProps = {
  variant: 'hub' | 'editor'
}

/**
 * `ThemeToggle` already mounts `useAppearance`; this second mount is
 * deliberate and safe. It is the *editor* nav that needs it — the editor is a
 * separate route from the Hub, so the Hub's mount is long gone by the time the
 * editor chrome appears, and without a mount here the editor would depend
 * entirely on the pre-paint script and never learn about a change made in
 * another tab. Both instances read the same stored value and write the same
 * attributes, and `applyAppearance` skips attributes that already hold the
 * wanted value, so the second mount costs no DOM writes and the two cannot
 * fight.
 *
 * `AppearanceMenu` is here rather than behind the theme toggle because the
 * toggle is a two-state switch and the panel is the six settings behind it: a
 * control that opens the settings is a different affordance from one that flips
 * a single one, and putting them side by side is what makes the panel
 * discoverable without a fourteenth tab.
 */
export function Nav({ variant }: NavProps) {
  useAppearance()
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <span className="brand">
          <span className="brand__mark" aria-hidden="true">
            🎨
          </span>
          Image Editor<span className="brand__dot">.</span>
        </span>
        <div className="nav-actions">
          <AppearanceMenu />
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
  )
}
