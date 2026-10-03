import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness } from '../../store/testHarness'
import { EmptyState } from './EmptyState'

const harness = createHarness()

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')
/** Comments explain *why*; the declarations are what a reader of the cascade
 *  actually gets. Comment-stripping is what lets the assertions below be about
 *  the rules rather than about the prose describing them. */
const rules = read('src/components/ui/emptyState.module.css').replace(/\/\*[\s\S]*?\*\//g, '')
const source = read('src/components/ui/EmptyState.tsx')

function region(): HTMLElement | null {
  return harness.container.querySelector<HTMLElement>('[role="group"]')
}

/** The values of every declaration of `property`. The `(?![-\w])` guard is what
 *  keeps `declarations('border')` from also matching `border-radius`. */
function declarations(property: string): string[] {
  const pattern = new RegExp(`(?:^|[;{\\s])${property}(?![-\\w])[^:]*:\\s*([^;]+);`, 'g')
  return [...rules.matchAll(pattern)].map((match) => match[1].trim())
}

function mount(
  props: {
    title?: string
    description?: string
    action?: string
    className?: string
  } = {},
) {
  harness.render(
    <EmptyState
      title={props.title ?? 'Draw'}
      description={
        props.description ??
        'Nothing has been drawn yet. Sketches sit on their own layer, above the photo.'
      }
      action={props.action ? <button type="button">{props.action}</button> : undefined}
      className={props.className}
    />,
  )
}

beforeEach(() => {
  document.body.focus()
  mount()
})

afterEach(() => harness.unmount())

describe('EmptyState is a labelled region', () => {
  it('names the group from its own title, with no second copy of the string', () => {
    const labelledBy = region()?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    // `useId` mints ids containing colons, which no `#id` selector can address.
    const heading = Array.from(harness.container.querySelectorAll('h3')).find(
      (node) => node.id === labelledBy,
    )
    expect(heading?.textContent).toBe('Draw')
    expect(harness.container.textContent?.match(/Draw/g)).toHaveLength(1)
  })

  it('is not a landmark, so thirteen panels cannot flood the landmarks rotor', () => {
    // A `role="region"` here would be defensible in isolation. It is wrong for
    // this app: the sheet is already a labelled dialog, so every empty state
    // would add a peer of `main` that you cannot navigate to. Asserted because
    // the temptation to "just use a landmark" is exactly what would put them
    // back.
    expect(region()?.getAttribute('role')).toBe('group')
    expect(harness.container.querySelector('[role="region"]')).toBeNull()
  })

  it('renders the title, the explanation and the action, in that order', () => {
    mount({ action: 'New drawing layer' })
    const text = Array.from(region()?.children ?? []).map((child) => child.textContent)
    expect(text).toHaveLength(3)
    expect(text[0]).toBe('Draw')
    expect(text[1]).toMatch(/Nothing has been drawn yet/)
    expect(text[2]).toBe('New drawing layer')
  })

  it('omits the action row entirely when there is no action', () => {
    expect(region()?.children).toHaveLength(2)
  })

  it('appends the caller className without dropping its own', () => {
    mount({ className: 'panel-note' })
    const className = region()?.className ?? ''
    expect(className).toMatch(/panel-note/)
    // The hashed module class is still there, so the caller's class is additive.
    expect(className.split(/\s+/).filter(Boolean)).toHaveLength(2)
  })
})

describe('EmptyState is static explanatory content, not an alert', () => {
  it('carries no live region and no assertive affordance', () => {
    const root = region()
    expect(root?.getAttribute('aria-live')).toBeNull()
    expect(root?.getAttribute('aria-atomic')).toBeNull()
    expect(root?.hasAttribute('aria-busy')).toBe(false)
    expect(harness.container.querySelector('[role="alert"]')).toBeNull()
    expect(harness.container.querySelector('[role="status"]')).toBeNull()
  })

  it('does not take focus, and adds nothing to the tab order', () => {
    mount({ action: 'New drawing layer' })
    expect(region()?.hasAttribute('tabindex')).toBe(false)
    expect(harness.container.querySelector('[tabindex]')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves the caller’s action focusable — it is the only way in', () => {
    mount({ action: 'New drawing layer' })
    const button = harness.container.querySelector('button')
    expect(button?.getAttribute('type')).toBe('button')
    expect(button?.textContent).toBe('New drawing layer')
  })
})

describe('EmptyState keeps the caller in charge of the copy', () => {
  it('supplies no fallback string of its own', () => {
    // The component has no default text. A generic "Nothing here yet" is the
    // string it exists to replace, and a component that *can* supply one will
    // eventually be handed a null description and quietly fall back to it.
    const body = source.slice(source.indexOf('export function EmptyState'))
    expect(body).toMatch(/title/)
    expect(body).not.toMatch(/Nothing here|Coming soon|No items|is empty|yet\./i)
  })

  it('renders whatever explanation it is handed, including a sentence and a list', () => {
    harness.render(
      <EmptyState
        title="Text layers"
        description={
          <>
            <p>Text sits on its own layer, so it can be moved after the fact.</p>
            <ul>
              <li>Place it on the canvas.</li>
            </ul>
          </>
        }
      />,
    )
    expect(region()?.textContent).toMatch(/moved after the fact/)
    expect(harness.container.querySelector('ul > li')?.textContent).toBe('Place it on the canvas.')
  })
})

describe('EmptyState participates in the appearance scales', () => {
  it('multiplies every font-size by a scaled token', () => {
    // A text-size preference that moves eight named steps and misses the rest of
    // the type is a rebrand with a settings screen. An empty state whose type
    // ignores `data-text` is exactly that hole.
    const sizes = declarations('font-size')
    expect(sizes.length).toBeGreaterThanOrEqual(2)
    for (const value of sizes) expect(value).toMatch(/var\(--font-[a-z0-9]+\)/)
  })

  it('multiplies every gap, margin and padding by the density factor', () => {
    const spaces = [...rules.matchAll(/(?:margin|padding|gap):\s*([^;]+);/g)].map((m) =>
      m[1].trim(),
    )
    expect(spaces.length).toBeGreaterThanOrEqual(4)
    for (const value of spaces) {
      // `0` is the one value on the space scale that needs no multiplier: it is
      // the same zero at every density.
      expect(value, value).toMatch(
        /var\(--density-factor\)|var\(--space-[a-z0-9]+\)|var\(--ie-tap\)|(^|[\s(])0([\s)]|$)/,
      )
    }
  })

  it('draws no colour, fill or radius as a literal', () => {
    for (const property of ['color', 'background', 'border-radius']) {
      const values = declarations(property)
      expect(values.length, property).toBeGreaterThan(0)
      for (const value of values) {
        // A token, or — in the forced-colors block only — one of the system
        // colours Windows guarantees to contrast with the canvas.
        expect(value, `${property}: ${value}`).toMatch(/var\(--|^Canvas(Text)?$/)
        expect(value, `${property}: ${value}`).not.toMatch(/#[0-9a-f]{3}|rgba?\(/)
      }
    }
    for (const value of declarations('border')) {
      expect(value, `border: ${value}`).toMatch(/var\(--ie-hairline\)|CanvasText/)
    }
    expect(rules).toMatch(/var\(--ie-fill-quiet\)/)
  })

  it('animates nothing, so --motion-factor and --icon-scale have nothing to scale', () => {
    // Stated as a test because "no transition" is invisible in a diff, and the
    // obvious next change is a fade-in that would put a class of motion this
    // component has no reason to have into the app.
    expect(rules).not.toMatch(/transition|animation|@keyframes|transform:/)
    expect(rules).not.toMatch(/svg|::before|::after/)
  })

  it('paints itself in forced colours', () => {
    const block = rules.match(/@media \(forced-colors: active\) \{[\s\S]*\n\}/)?.[0]
    expect(block).toBeDefined()
    expect(block).toContain('Canvas')
    expect(block).toContain('CanvasText')
  })
})
