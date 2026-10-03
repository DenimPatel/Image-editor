import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { useAppearance } from '../../hooks/useAppearance'
import {
  ACCENTS,
  ACCENT_IDS,
  ACCENT_SURFACES,
  DENSITIES,
  DEFAULT_APPEARANCE,
  ICON_SCALES,
  MOTION_PREFERENCES,
  TEXT_SCALES,
  THEME_PREFERENCES,
  applyAppearance,
  writeAppearance,
  type AccentId,
  type AppearanceSettings,
  type Density,
  type IconScale,
  type MotionPreference,
  type TextScale,
  type ThemePreference,
} from '../../lib/appearance'
import { Button } from './Button'
import { CheckGlyph, PauseGlyph, PlayGlyph, SparkleGlyph } from './icons'
import styles from './appearanceMenu.module.css'

/**
 * The appearance panel: the six device-local settings that already reach the
 * document as six `data-*` attributes and that nothing could reach.
 *
 * Three decisions are load-bearing, and each one is the alternative this project
 * has already had to reject somewhere else.
 *
 * **It is a popover, not a fourteenth tool tab.** A tool tab costs a `TOOL_IDS`
 * entry, a `TITLES` entry, a `META` entry and a glyph, and it makes an
 * already-scrolling thirteen-item tab bar worse. This sits behind the existing
 * "More options" popover in the editor and beside the `ThemeToggle` on the Hub.
 *
 * **Every option previews itself.** A row of words asks the reader to imagine
 * the result; the accent swatches, the density rows, the text samples and the
 * icon sizes are drawn from the same tokens the setting moves, so the answer is
 * on screen before the click. Each preview multiplies by the *option's* factor
 * and by the live `--density-factor` / `--icon-scale`, and
 * `AppearanceMenu.test.tsx` reads `tokens.css` to assert the factors are the
 * ones the stylesheet actually uses: a preview that had drifted to a different
 * number from the one it previews would be a lie set in a different font.
 *
 * **A failed write is announced, not swallowed.** `writeAppearance` returns
 * `persisted: false` when `localStorage` refuses the write, which is what Safari
 * private mode does and what a blocked-storage setting does everywhere. The
 * setting still applies for the session, so the honest thing is to say so — the
 * user is told the choice is live and will not survive a reload, instead of
 * finding out later that the preference quietly reverted.
 */

export type AppearancePanelProps = {
  open: boolean
  onClose: () => void
  /**
   * Which chrome the panel is painted on. The Hub's palette and the editor's
   * hardcoded-dark one share no tokens below the accents, so a panel borrowing
   * one set would be unreadable in the other place.
   */
  surface?: 'hub' | 'editor'
  /** Edge the panel hangs from. `end` is the right-hand side of the chrome. */
  align?: 'start' | 'end'
  /** Optional id so a trigger can point `aria-controls` at it. */
  id?: string
  /**
   * The trigger, when the trigger lives outside the panel. The outside-press
   * and focus-outside dismissers have to leave it alone: the pointerdown that
   * closes the panel is followed by the trigger's own click, and if the dismisser
   * also treated the trigger as "outside", the two would fight and the panel
   * would open again instead of closing.
   */
  triggerRef?: React.RefObject<HTMLElement | null>
}

const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match system',
}

const DENSITY_LABELS: Record<Density, string> = {
  compact: 'Compact',
  default: 'Default',
  roomy: 'Roomy',
}

const TEXT_LABELS: Record<TextScale, string> = {
  small: 'Small',
  default: 'Default',
  large: 'Large',
  xlarge: 'Extra large',
}

const MOTION_LABELS: Record<MotionPreference, string> = {
  full: 'Animations on',
  reduced: 'Animations reduced',
}

const ICON_LABELS: Record<IconScale, string> = {
  small: 'Small',
  default: 'Default',
  large: 'Large',
}

type Choice<T extends string> = { value: T; label: string }

/**
 * One labelled group of radio buttons.
 *
 * Native radios rather than a `role="radiogroup"` assembled out of buttons: the
 * browser then owns the checked state, form semantics, and the fact that a group
 * is one Tab stop. The `aria-label` repeats the legend because "Default" is the
 * visible label of three different groups — "Density: Default" is both
 * unambiguous and a superset of the text on screen, which is what the
 * label-in-name rule asks for.
 *
 * Arrow keys are handled here rather than left to the browser, and the reason is
 * a measured disagreement. The APG radio-group pattern specifies that the arrows
 * *wrap*; Chromium wraps, and WebKit does not — with the checked state changed
 * from React rather than by the browser's own default action, WebKit's internal
 * navigation anchor never moves, so a second ArrowDown in the same group does
 * nothing at all and ArrowUp skips an option. Measured, both engines, on the
 * same markup. A setting group that answers the first arrow press and then goes
 * quiet is worse than one that was never arrow-operable, so the pattern is
 * implemented: both directions, wrapping at both ends, and focus travelling with
 * the selection.
 */
function ChoiceRow<T extends string>({
  legend,
  name,
  choices,
  value,
  onChange,
  preview,
}: {
  legend: string
  name: string
  choices: readonly Choice<T>[]
  value: T
  onChange: (next: T) => void
  preview?: (choice: Choice<T>) => ReactNode
}) {
  const fieldRef = useRef<HTMLFieldSetElement>(null)

  const onKeyDown = (event: ReactKeyboardEvent<HTMLFieldSetElement>) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward) return
    const current = choices.findIndex((choice) => choice.value === value)
    if (current < 0) return
    event.preventDefault()
    const next = (current + (forward ? 1 : -1) + choices.length) % choices.length
    onChange(choices[next].value)
    // Focus travels with the selection, as the pattern requires — a checked radio
    // that is not the focused one is the thing screen-reader users report as
    // "the control jumped".
    const inputs = fieldRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    inputs?.[next]?.focus()
  }

  return (
    <fieldset className={styles.field} ref={fieldRef} onKeyDown={onKeyDown}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.choices}>
        {choices.map((choice) => {
          const current = choice.value === value
          return (
            <label key={choice.value} className={styles.choice} data-current={current}>
              <input
                type="radio"
                className={styles.input}
                name={name}
                value={choice.value}
                checked={current}
                aria-label={`${legend}: ${choice.label}`}
                onChange={() => onChange(choice.value)}
              />
              {preview ? preview(choice) : null}
              <span className={styles.choiceLabel}>{choice.label}</span>
              {current && <CheckGlyph className={styles.choiceCheck} />}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** `true` when nothing has been changed from `DEFAULT_APPEARANCE`. */
function isDefault(settings: AppearanceSettings): boolean {
  return (Object.keys(DEFAULT_APPEARANCE) as (keyof AppearanceSettings)[]).every(
    (key) => settings[key] === DEFAULT_APPEARANCE[key],
  )
}

/**
 * The two grounds a theme choice can land on, as data rather than as CSS.
 *
 * A theme preview cannot be drawn with the tokens in scope — those are the
 * *panel's* theme, which is the one the reader is currently in, so a swatch
 * built from them would show the current theme under all three labels. The
 * numbers come from `ACCENT_SURFACES` in the appearance model, which is the
 * same block the accent contrast test measures against, so the preview and the
 * measurement cannot drift apart.
 */
const THEME_SWATCHES = {
  light: { bg: ACCENT_SURFACES.lightBg, surface: ACCENT_SURFACES.lightSurface },
  dark: { bg: ACCENT_SURFACES.darkBg, surface: ACCENT_SURFACES.darkSurface },
} as const

/** Half of one colour, half of the other, down the middle. */
function split(left: string, right: string): string {
  return `linear-gradient(to right, ${left} 0 50%, ${right} 50% 100%)`
}

/**
 * The miniature page for one theme option.
 *
 * `system` is not a third palette — it is "whichever the OS asks for" — so it is
 * drawn as the two of them at once, which is the only version of the answer that
 * is true before the reader clicks anything.
 */
function themePreview(preference: ThemePreference): { bar: string; body: string } {
  if (preference === 'system') {
    return {
      bar: split(THEME_SWATCHES.light.surface, THEME_SWATCHES.dark.surface),
      body: split(THEME_SWATCHES.light.bg, THEME_SWATCHES.dark.bg),
    }
  }
  const { bg, surface } = THEME_SWATCHES[preference]
  return { bar: surface, body: bg }
}

export function AppearancePanel({
  open,
  onClose,
  surface = 'hub',
  align = 'end',
  id,
  triggerRef,
}: AppearancePanelProps) {
  const { settings: stored, resolvedTheme } = useAppearance()
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const [persisted, setPersisted] = useState(true)
  const [session, setSession] = useState<AppearanceSettings | null>(null)
  const generatedId = useId()
  const panelId = id ?? generatedId
  const titleId = `${panelId}-title`

  // What the panel shows: the stored settings, or — after a write the browser
  // refused — the ones the reader just chose. The hook cannot be the answer on
  // its own here, because it answers its own write announcement by re-reading
  // storage, and storage still holds the value from before the refusal.
  const settings = session ?? stored

  const apply = useCallback((patch: Partial<AppearanceSettings>) => {
    const result = writeAppearance(patch)
    setPersisted(result.persisted)
    if (result.persisted) {
      // Storage is back, so the session override has nothing left to override:
      // the hooks are about to re-read the value that just landed.
      setSession(null)
      return
    }
    // A refused write still has to change the app for this session: the reader
    // is looking at the document, and "it did not save" does not mean "it did
    // not apply". Safari private mode and blocked-storage settings both produce
    // exactly this state, and silently swallowing it is how a preference
    // disappears without anybody deciding it should.
    setSession(result.settings)
  }, [])

  useEffect(() => {
    if (!session) return
    // The failed write still announced itself on `window`, and every *other*
    // mounted hook answers that by re-reading storage — so their effects re-apply
    // the old value after this component's. A frame is the only ordering that
    // leaves the document showing what the reader chose: React's passive effects
    // have all run by then. On the next successful write `session` is cleared and
    // this stops competing with the hooks that are already correct.
    const frame = requestAnimationFrame(() => applyAppearance(session))
    return () => cancelAnimationFrame(frame)
  }, [session])

  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement ? active : null
    // The panel itself, not the first radio: focusing a control before the
    // reader has reached the heading is the same hostility as focusing a
    // dismiss control, and the first Tab lands on the Theme group anyway.
    panelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (open) return
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected) opener.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    // Captured on `document`, and stopped in the capture phase:
    // `useKeyboardShortcuts` listens for Escape on `window` to cancel the open
    // tool, so a keydown that reaches it would close the sheet as well as this
    // panel. React's own listener is attached below this point in the tree,
    // which is what makes the capture listener the one that sees it first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    const inside = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false
      if (panelRef.current?.contains(target) === true) return true
      return triggerRef?.current?.contains(target) === true
    }
    const onPointerDown = (event: Event) => {
      if (inside(event.target)) return
      // No focus restore: a press outside is about to own focus, and stealing
      // it back would fight the thing the reader just clicked.
      onClose()
    }
    const onFocusIn = (event: Event) => {
      if (inside(event.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open, onClose, triggerRef])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`${styles.panel} ${surface === 'editor' ? styles.editor : ''} ${
        align === 'start' ? styles.alignStart : styles.alignEnd
      }`}
      onKeyDown={(event) => {
        // Tab and Shift+Tab deliberately fall through: the `focusin` listener
        // closes the panel once focus has actually left it, which is what lets a
        // keyboard user walk on down the page instead of hitting a trap.
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          Appearance
        </h2>
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>

      <div className={styles.body}>
        <ChoiceRow
          legend="Theme"
          name="appearance-theme"
          choices={THEME_PREFERENCES.map((value) => ({ value, label: THEME_LABELS[value] }))}
          value={settings.theme}
          onChange={(theme) => apply({ theme })}
          preview={({ value }) => {
            const swatch = themePreview(value)
            return (
              /* A little page, because "Light" / "Dark" / "Match system" as three
                 words asks the reader to imagine the result — which is the one
                 thing this panel exists not to do. */
              <span className={styles.themePreview} data-preview="" aria-hidden="true">
                <span className={styles.themePreviewBar} style={{ background: swatch.bar }} />
                <span className={styles.themePreviewBody} style={{ background: swatch.body }} />
              </span>
            )
          }}
        />
        {surface === 'editor' && (
          /* The editor's own chrome is dark in every theme. `--ie-canvas-bg`,
             `--ie-chrome` and `--ie-ink` are declared once on `:root` and are
             only overridden under `forced-colors`, so choosing Light or Dark
             here moves no pixel on this screen — measured: `--ie-chrome` stays
             `rgba(28,28,30,0.82)` and `--ie-ink` stays `#f2f2f7` under both. A
             photo editor that stays dark is a defensible decision, but a radio
             group that takes the click and changes nothing looks broken, so the
             panel says where the theme does apply. */
          <p className={styles.warning}>
            The canvas and the panels around it stay dark whatever you pick here — a photo reads
            truer against a neutral ground. Your theme applies to the home screen and is remembered
            for next time.
          </p>
        )}

        <ChoiceRow
          legend="Accent"
          name="appearance-accent"
          choices={ACCENTS.map((accent) => ({ value: accent.id, label: accent.label }))}
          value={settings.accent}
          onChange={(accent) => apply({ accent })}
          preview={({ value }) => {
            const accent = ACCENTS.find((entry) => entry.id === value) ?? ACCENTS[0]
            // The dark half is the pairing a reader on the dark ground will
            // actually see, so the swatch follows the resolved theme rather than
            // always previewing the light one.
            const tokens = resolvedTheme === 'dark' ? accent.dark : accent.light
            return (
              <span
                className={styles.swatch}
                data-preview=""
                style={{ background: tokens['--accent-tint'], color: tokens['--accent-ink'] }}
              >
                Aa
              </span>
            )
          }}
        />

        <ChoiceRow
          legend="Density"
          name="appearance-density"
          choices={DENSITIES.map((value) => ({ value, label: DENSITY_LABELS[value] }))}
          value={settings.density}
          onChange={(density) => apply({ density })}
          preview={({ value }) => (
            <span className={styles.densityPreview} data-preview="" data-step={value}>
              <span />
              <span />
              <span />
            </span>
          )}
        />

        <ChoiceRow
          legend="Text size"
          name="appearance-text"
          choices={TEXT_SCALES.map((value) => ({ value, label: TEXT_LABELS[value] }))}
          value={settings.textScale}
          onChange={(textScale) => apply({ textScale })}
          preview={({ value }) => (
            <span className={styles.textPreview} data-preview="" data-step={value}>
              Aa
            </span>
          )}
        />

        <ChoiceRow
          legend="Motion"
          name="appearance-motion"
          choices={MOTION_PREFERENCES.map((value) => ({ value, label: MOTION_LABELS[value] }))}
          value={settings.motion}
          onChange={(motion) => apply({ motion })}
          preview={({ value }) => (
            /* Play for on, pause for reduced. Neither of them moves, on purpose:
               a control that demonstrates "Animations reduced" by animating is
               the one control a reader who chose it cannot use. */
            <span className={styles.iconPreview} data-preview="" aria-hidden="true">
              {value === 'reduced' ? <PauseGlyph /> : <PlayGlyph />}
            </span>
          )}
        />

        <ChoiceRow
          legend="Icon size"
          name="appearance-icons"
          choices={ICON_SCALES.map((value) => ({ value, label: ICON_LABELS[value] }))}
          value={settings.iconScale}
          onChange={(iconScale) => apply({ iconScale })}
          preview={({ value }) => (
            <span className={styles.iconPreview} data-preview="" data-step={value}>
              <SparkleGlyph />
            </span>
          )}
        />
      </div>

      <div className={styles.foot}>
        <button
          type="button"
          className={styles.reset}
          onClick={() => {
            if (session) {
              // Storage is already known to be unavailable, so a second write
              // would only be a second announcement that the other mounted hooks
              // answer by reverting. Keep the session value moving instead.
              setSession(DEFAULT_APPEARANCE)
              return
            }
            setSession(null)
            apply(DEFAULT_APPEARANCE)
          }}
          disabled={isDefault(settings)}
        >
          Reset to defaults
        </button>
        {!persisted && (
          <p className={styles.warning} role="status">
            This browser blocked local storage, so this change is not saved. It applies to this
            session and will be gone after a reload.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The panel behind its own trigger, for the Hub's nav.
 *
 * The editor does not use this. There the panel is opened from an item in the
 * existing "More options" menu, which means the caller owns the open state, and
 * a second trigger next to that menu would be two affordances for one panel.
 */
export function AppearanceMenu({ align = 'end' }: { align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)

  return (
    <span className={styles.anchor} ref={anchorRef}>
      <Button
        as="button"
        variant="ghost"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        Appearance
      </Button>
      {/* Rendered whether or not it is open, rather than mounted on demand: the
          focus-restore effect lives inside the panel, so unmounting the panel
          on close would throw away the reference to whatever opened it and the
          opener would never get focus back. The panel returns `null` itself when
          it is closed. */}
      <AppearancePanel
        open={open}
        id={panelId}
        align={align}
        triggerRef={anchorRef}
        onClose={() => setOpen(false)}
      />
    </span>
  )
}

/** The accent ids, re-exported so a test can assert the panel offers all four. */
export const ACCENT_CHOICE_IDS: readonly AccentId[] = ACCENT_IDS
