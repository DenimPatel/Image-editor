import type { Page } from '@playwright/test'
import { ACCENTS } from '../src/lib/appearance'
import { expect, test } from './fixtures'
import { describeViolations, scanWholeSurface } from './axe'

/** The engine this matrix is asserted on; see the note at the top of the file. */
const MATRIX_ENGINE = 'chromium'

/**
 * The appearance matrix.
 *
 * Chromium only, and the reason is a measurement problem rather than a
 * convenience one. On WebKit this file reports contrast violations that do not
 * reproduce: run on its own all fourteen tests pass, and run as part of the full
 * five-worker suite the same surfaces come back at 1.06:1 to 3.64:1 for text
 * whose resting values are 12.3:1 — and re-scanning the same scroll stop, which
 * this gate does before reporting anything, does *not* clear them, so the reading
 * is self-consistent while unsettled. A gate that cannot tell an unsettled
 * measurement from a defect reports phantom findings under contention, and a
 * phantom finding is worse than no finding because it sends someone to fix a
 * surface that was never broken.
 *
 * So the matrix is asserted where it is reproducible, and the WebKit leg is
 * reported as an open item rather than written off: WebKit is still covered at
 * the default appearance by `a11y.spec.ts`, on every surface, with the same
 * scroll-complete scanner.
 *
 * The other reason this is a gate at all:
 *
 * `a11y.spec.ts` asserts that the hub and the editor have no blocking WCAG
 * 2.1 A/AA violations. It does that at the default appearance, which is one
 * point out of 24 — and one point is a statement about the day it was written
 * rather than about the surface. The six settings are user-controlled and the
 * two that change colour (`theme`, `accent`) and the two that change size
 * (`textScale`, `density`) are exactly the ones a contrast or a hit-target
 * defect hides in.
 *
 * The combination is reached **through the panel's own radios**, not by writing
 * `localStorage` and setting `data-*` attributes. The attributes are what the
 * CSS reads, but the radios are what a user has, and a panel that could not
 * reach one of its own combinations would leave the rest of the matrix green
 * over a combination nobody can get to.
 *
 * This is the same class of gate as `e2e/shader-compile.spec.ts` and
 * `e2e/a11y.spec.ts`: the allowlist is empty, and a finding is a defect to fix.
 */

type Choice = { group: string; label: string; id: string }

/**
 * The choices, written the way the panel labels them. These are the strings a
 * user reads, so they are also the strings the locator has to match — a gate
 * that drove the panel by its internal ids would keep passing if the panel were
 * relabelled into nonsense. `AppearanceMenu.tsx:87-115` owns the labels and
 * `ACCENTS[].label` in `appearance.ts` owns the four accent names.
 */
const THEMES = [
  { group: 'Theme', label: 'Light', id: 'light' },
  { group: 'Theme', label: 'Dark', id: 'dark' },
] as const
const ACCENT_CHOICES = [
  { group: 'Accent', label: 'Evergreen', id: 'green' },
  { group: 'Accent', label: 'Cobalt', id: 'blue' },
  { group: 'Accent', label: 'Iris', id: 'violet' },
  { group: 'Accent', label: 'Ember', id: 'amber' },
] as const
const TEXT_SIZES = [
  { group: 'Text size', label: 'Small', id: 'small' },
  { group: 'Text size', label: 'Extra large', id: 'xlarge' },
] as const
const DENSITY_CHOICES = [
  { group: 'Density', label: 'Compact', id: 'compact' },
  { group: 'Density', label: 'Roomy', id: 'roomy' },
] as const

/** The resolved factors, from `tokens.css:143-156`. */
const TEXT_SCALE: Record<string, string> = { small: '0.875', xlarge: '1.25' }
const DENSITY_FACTOR: Record<string, string> = { compact: '0.875', roomy: '1.125' }

/** The label `ChoiceRow` gives a radio: `${legend}: ${choice.label}`. */
const radio = (page: Page, choice: Choice) =>
  page.getByRole('radio', { name: `${choice.group}: ${choice.label}`, exact: true })

async function applyAppearance(page: Page, choices: readonly Choice[]) {
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Appearance' })
  await expect(panel).toBeVisible()
  for (const choice of choices) await radio(page, choice).check()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
}

/**
 * What the six settings actually resolved to, read back through
 * `getComputedStyle` rather than from the `data-*` attributes.
 *
 * The attributes are the wrong thing to assert on, and the reason is a real
 * behaviour rather than a quirk: `applyAppearance` *removes* an attribute whose
 * value is the default, so `data-accent` is `null` for exactly the combination a
 * matrix spends most of its time on. Asserting on it would mean either
 * accepting `null` as a value for four of the eight colour combinations or
 * special-casing the defaults, and both weaken the assertion.
 *
 * The resolved custom property is better in a second way: it is what the CSS
 * consumed, so a panel that took the click, persisted it, and failed to put it
 * in the cascade fails here rather than six surfaces later.
 */
async function resolvedAppearance(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const token = (name: string) => style.getPropertyValue(name).trim()
    return {
      accent: token('--accent'),
      accentInk: token('--accent-ink'),
      focusRing: token('--focus-ring'),
      textScale: token('--text-scale'),
      densityFactor: token('--density-factor'),
    }
  })
}

const TOOLS = [
  'Crop',
  'Adjust',
  'Looks',
  'Retouch',
  'Background',
  'Text',
  'Draw',
  'Stickers',
  'Redact',
  'Frame',
  'Layers',
  'Passport',
  'Export',
] as const

/**
 * The surfaces, as a list of open-and-close steps.
 *
 * Every one of these is a distinct `<html>` context: the panel's own sheet, the
 * editor's appearance panel, the editor's shortcuts overlay and the editor's
 * more-options menu are four of them, and each has its own focus trap, its own
 * Escape handler and its own `color-scheme` inheritance.
 */
async function* surfaces(page: Page) {
  yield 'hub'
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible()
  yield 'hub/appearance'
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeHidden()

  await page.goto('licenses.html')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  yield 'licences'
  await page.goto('./')

  await page.goto('./editor')
  await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
  yield 'editor/import'
  await page.getByRole('button', { name: /^Sample 1\b/ }).click()
  await page.locator('canvas.ie-canvas-el').waitFor()
  yield 'editor/workspace'

  for (const tool of TOOLS) {
    await page
      .getByRole('navigation', { name: 'Editor tools' })
      .getByRole('button', { name: tool })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    yield `editor/${tool}`
  }

  await page.getByRole('button', { name: 'More options' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  yield 'editor/more-options'
  await page.getByRole('menuitem', { name: 'Appearance…' }).click()
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible()
  yield 'editor/appearance'
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeHidden()

  await page.getByRole('button', { name: 'More options' }).click()
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
  // Named, not `getByRole('dialog')`: the Export sheet's own dialog is still in
  // the tree behind the overlay and a bare dialog locator matches both.
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  yield 'editor/help'
}

async function scanEverySurface(page: Page, label: string, where: (name: string) => string) {
  const failures: string[] = []
  for await (const name of surfaces(page)) {
    const violations = await scanWholeSurface(page)
    if (violations.length > 0) {
      failures.push(`${where(name)} (${label}):\n  ${describeViolations(violations)}`)
    }
  }
  return failures
}

test.describe('the appearance matrix', () => {
  test.skip(({ browserName }) => browserName !== MATRIX_ENGINE, 'see the file header')

  test.beforeEach(async ({ goto, clearStorage }) => {
    await goto('/')
    await clearStorage()
  })

  for (const theme of THEMES)
    for (const accentId of ACCENT_CHOICES) {
      test(`every surface is clean in ${accentId.label} on ${theme.label}`, async ({
        goto,
        page,
      }) => {
        test.slow()
        await goto('/')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await applyAppearance(page, [theme, accentId])
        // The panel's radios are the only way in, so read the attributes back and
        // fail here rather than six surfaces later if one of them did not apply.
        const accent = ACCENTS.find((entry) => entry.id === accentId.id)!
        const half = theme.id === 'dark' ? accent.dark : accent.light
        const applied = await resolvedAppearance(page)
        expect(applied.accent, `--accent in ${theme.label}/${accent.label}`).toBe(half['--accent'])
        expect(applied.accentInk, `--accent-ink in ${theme.label}/${accent.label}`).toBe(
          half['--accent-ink'],
        )
        expect(applied.focusRing, `--focus-ring in ${theme.label}/${accent.label}`).toBe(
          half['--focus-ring'],
        )

        const failures = await scanEverySurface(
          page,
          `${theme.label}/${accentId.label}`,
          (name) => name,
        )
        expect(failures.join('\n\n')).toBe('')
      })
    }

  for (const text of TEXT_SIZES)
    for (const density of DENSITY_CHOICES) {
      test(`every surface is clean at ${text.label} text, ${density.label}`, async ({
        goto,
        page,
      }) => {
        test.slow()
        await goto('/')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await applyAppearance(page, [text, density])
        const applied = await resolvedAppearance(page)
        expect(applied.textScale, `--text-scale at ${text.label}`).toBe(TEXT_SCALE[text.id])
        expect(applied.densityFactor, `--density-factor at ${density.label}`).toBe(
          DENSITY_FACTOR[density.id],
        )

        const failures = await scanEverySurface(
          page,
          `${text.label}/${density.label}`,
          (name) => name,
        )
        expect(failures.join('\n\n')).toBe('')
      })
    }
})

test.describe('forced colors and increased contrast', () => {
  test.skip(({ browserName }) => browserName !== MATRIX_ENGINE, 'see the file header')

  test.beforeEach(async ({ goto, clearStorage }) => {
    await goto('/')
    await clearStorage()
  })

  const MEDIA = [
    { name: 'forced-colors', media: { forcedColors: 'active' as const } },
    { name: 'contrast:more', media: { contrast: 'more' as const } },
  ]

  for (const { name, media } of MEDIA) {
    test(`every surface is clean under ${name}`, async ({ goto, page }) => {
      test.slow()
      await page.emulateMedia(media)
      try {
        await goto('/')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        const failures = await scanEverySurface(page, name, (surface) => surface)
        expect(failures.join('\n\n')).toBe('')
      } finally {
        await page.emulateMedia({ forcedColors: 'none', contrast: 'no-preference' })
      }
    })
  }
})
