import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INSPECTOR_MEDIA } from './useMediaQuery'

/** CSS-only fixes cannot be proved by rendering, so the shipped stylesheets and
 *  the shipped document head are asserted as text. Read from disk rather than
 *  through a `?raw` import so the assertion sees the file the build ships. */
const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8')
const INDEX_HTML = read('index.html')
const baseCss = read('src/styles/base.css')
const tokensCss = read('src/styles/tokens.css')
const editorCss = read('src/components/editor/editor.module.css')
const controlsCss = read('src/components/controls/controls.module.css')

/** Split a CSS shorthand into its components without cutting inside a `calc()`. */
const splitShorthand = (value: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value.trim()) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ' ' && depth === 0) {
      if (current) parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) parts.push(current)
  return parts
}

describe('D8-F04: the safe-area environment variables can resolve at all', () => {
  it('index.html asks for the viewport to cover the safe area', () => {
    const meta = INDEX_HTML.match(/<meta\s[^>]*name="viewport"[^>]*>/)?.[0]
    expect(meta).toBeDefined()
    expect(meta).toContain('width=device-width')
    // Without viewport-fit=cover Safari insets the layout viewport to the safe
    // area itself, so every env(safe-area-inset-*) token below resolves to 0px
    // and the top bar sits under the notch.
    expect(meta).toContain('viewport-fit=cover')
  })

  it('every safe-area consumer reads a real inset token', () => {
    for (const name of ['--ie-safe-top', '--ie-safe-right', '--ie-safe-bottom', '--ie-safe-left']) {
      expect(tokensCss).toContain(`${name}: env(safe-area-inset-`)
    }
    // The tab bar's 4-value shorthand is `top right bottom left`, and the bug
    // this was written for is the right side taking the left inset and vice
    // versa. Assert the *inset each side reads*, not the pixel count: the
    // `6px` top and bottom are spacing and are free to move onto the space
    // scale without this test needing to know, whereas which inset goes where
    // is the thing that must never be wrong.
    const tabBar = editorCss.match(/\.tabBar \{([\s\S]*?)\n\}/)?.[1]
    expect(tabBar).toBeDefined()
    const shorthand = tabBar?.match(/padding:\s*([^;]*);/)?.[1]?.replace(/\s+/g, ' ')
    expect(shorthand).toBeDefined()
    const [top, right, bottom, left] = splitShorthand(shorthand!)
    expect(right).toContain('var(--ie-safe-right)')
    expect(right).not.toContain('var(--ie-safe-left)')
    expect(left).toContain('var(--ie-safe-left)')
    expect(left).not.toContain('var(--ie-safe-right)')
    // The detent lifts off the home indicator, and the top edge is flush
    // against the top bar — there is no safe inset to clear up there.
    expect(bottom).toContain('var(--ie-safe-bottom)')
    expect(top).not.toContain('var(--ie-safe-')
  })
})

describe('D8-F12: a focus ring is authored once, from one token', () => {
  it('has a single zero-specificity :focus-visible rule', () => {
    const rules = baseCss.match(/:focus-visible/g) ?? []
    expect(rules.length).toBeGreaterThanOrEqual(1)
    expect(baseCss).toMatch(
      /:where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible\s*\{\s*outline: 2px solid var\(--focus-ring\)/,
    )
  })

  it('declares the token for the light hub and for the hardcoded-dark editor', () => {
    expect(tokensCss).toMatch(/--focus-ring: #[0-9a-f]{6};/)
    // The editor's ground is hardcoded dark whatever the hub theme is, so it
    // has to redeclare the ring or it inherits the light surface's colour.
    expect(editorCss).toMatch(/--focus-ring: var\(--ie-accent-bright\)/)
  })
})

describe('D8-F13: forced-colors and increased contrast are honoured', () => {
  it('remaps the palette onto system colours', () => {
    const block = tokensCss.match(/@media \(forced-colors: active\) \{[\s\S]*\n\}/)?.[0]
    expect(block).toBeDefined()
    for (const system of ['Canvas', 'CanvasText', 'Highlight']) {
      expect(block).toContain(system)
    }
    // ButtonFace/ButtonText are the button-specific pair, used by the chrome
    // blocks that give buttons a visible border in High Contrast.
    expect(baseCss).toMatch(/@media \(forced-colors: active\)[\s\S]*ButtonFace/)
  })

  it('the block outranks the theme selectors on specificity', () => {
    // `:root:not([data-theme])` beats a bare `:root`, so an override that only
    // used `:root` would silently lose to the dark palette.
    expect(tokensCss).toMatch(
      /@media \(forced-colors: active\) \{[\s\S]*:root\[data-theme\],[\s\S]*:root:not\(\[data-theme\]\)/,
    )
  })

  it('has a prefers-contrast: more block', () => {
    expect(tokensCss).toContain('@media (prefers-contrast: more)')
  })
})

describe('D8-F01/F02/F03: the sheet layout rules that CSS-only changes rely on', () => {
  it('the canvas gutter is a compound selector, matching the one element that has both classes', () => {
    expect(editorCss).toContain('.canvasRegion.withSheet {')
    // The descendant form could never match: Editor.tsx puts both classes on
    // the same element, so the inspector overlaid the canvas.
    expect(editorCss).not.toContain('.withSheet .canvasRegion')
  })

  it('the desktop inspector stretches rather than taking a height', () => {
    const desktop = controlsCss.match(
      /@media \(min-width: 900px\) \{[\s\S]*?\.sheet \{[\s\S]*?\n {2}\}/,
    )?.[0]
    expect(desktop).toBeDefined()
    expect(desktop).toContain('top: 0')
    expect(desktop).toContain('bottom: 0')
    expect(desktop).toContain('height: auto')
  })

  it('the sheet and the inspector share one breakpoint constant', () => {
    expect(INSPECTOR_MEDIA).toBe('(min-width: 900px)')
    expect(baseCss).not.toContain(INSPECTOR_MEDIA)
  })
})

describe('D8-F07: the dead stylesheet is gone', () => {
  it('index.css no longer imports it', () => {
    const index = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8')
    expect(index).not.toContain('editor-legacy')
    expect(index).toContain("'./tokens.css'")
  })

  it('the file no longer exists', () => {
    expect(existsSync(resolve(process.cwd(), 'src/styles/editor-legacy.css'))).toBe(false)
  })
})

describe('D8-F14: index.html carries its metadata', () => {
  it('has a description, theme colours, Open Graph tags and a noscript fallback', () => {
    expect(INDEX_HTML).toMatch(/<meta\s+name="description"/)
    expect(INDEX_HTML).toContain('name="theme-color"')
    expect(INDEX_HTML).toContain('property="og:title"')
    expect(INDEX_HTML).toContain('property="og:description"')
    expect(INDEX_HTML).toContain('<noscript>')
    expect(INDEX_HTML).toContain('apple-mobile-web-app-capable')
  })

  it('guards both inline scripts against blocked storage', () => {
    const scripts = [...INDEX_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    expect(scripts.length).toBeGreaterThanOrEqual(2)
    for (const script of scripts) {
      // Safari private mode throws a SecurityError on any storage access, and
      // the sessionStorage one used to be unguarded.
      expect(script).toContain('try {')
      expect(script).toContain('} catch')
    }
  })
})
