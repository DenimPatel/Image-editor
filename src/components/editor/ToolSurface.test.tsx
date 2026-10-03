import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, resetStores } from '../../store/testHarness'
import { TOOL_IDS, useUiStore, type ToolId } from '../../store/uiStore'
import { ToolSurface } from './ToolSurface'

// The Retouch panel paints its placement pad through the real pipeline. There is
// no WebGL2 and no 2D canvas in jsdom, so the pad's proxy render is stubbed
// here; `RetouchPanel.test.tsx` is where the pad's own failure path is checked.
vi.mock('../../render/exportCanvas', () => ({
  renderExportCanvas: vi.fn(async () => {
    throw new Error('not stubbed for this test')
  }),
  ExportAbortedError: class ExportAbortedError extends Error {},
}))

const harness = createHarness()

/** Every `.tsx` under a directory, as repo-relative paths. */
function tsxSourcesUnder(dir: string): string[] {
  const found: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(resolve(process.cwd(), current), { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.tsx')) found.push(path)
    }
  }
  walk(dir)
  return found
}

const noop = () => {}

/** jsdom has no ImageBitmap, and nothing here reads one. */
const STUB_SOURCE = { width: 1600, height: 900 } as unknown as ImageBitmap

function surface(tool: ToolId) {
  useUiStore.getState().setActiveTool(tool)
  act(() => {
    harness.render(<ToolSurface source={STUB_SOURCE} fileName="p.png" onAuto={noop} />)
  })
  return harness.container.textContent ?? ''
}

/** The tool panel each tab actually renders, and whether it is the placeholder. */
const TOOL_COMPONENT: Partial<Record<ToolId, string>> = {
  crop: 'CropPanel',
  adjust: 'AdjustPanel',
  filters: 'FiltersPanel',
  retouch: 'RetouchPanel',
  background: 'BackgroundPanel',
  text: 'TextPanel',
  draw: 'DrawPanel',
  stickers: 'StickersPanel',
  redact: 'RedactPanel',
  frame: 'FramePanel',
  layers: 'LayersPanel',
  passport: 'PassportPanel',
  export: 'ExportSheet',
}

/** The placeholder tools: the ones that really have no panel behind them. */
const PLACEHOLDER_TOOLS = TOOL_IDS.filter((tool) => !TOOL_COMPONENT[tool])

/** Every non-test `.tsx` under a directory, so "no control writes to X" can be checked. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return tsxFiles(full)
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [full] : []
  })
}

/** Every `.tsx` a retouch control could live in, as paths relative to the repo. */
function retouchWriters(): string[] {
  const roots = [
    ...tsxFiles(resolve(process.cwd(), 'src/components')),
    ...tsxFiles(resolve(process.cwd(), 'src/pages')),
  ]
  return roots
    .filter((file) =>
      /setRetouch|addHealSpot|removeHealSpot|addRedEye|removeRedEye|clearRedEye|clearRetouch/.test(
        readFileSync(file, 'utf8'),
      ),
    )
    .map((file) => file.slice(process.cwd().length + 1))
    .sort()
}

const surfaceSource = () =>
  readFileSync(resolve(process.cwd(), 'src/components/editor/ToolSurface.tsx'), 'utf8')

beforeEach(() => {
  resetStores()
})

afterEach(() => harness.unmount())

describe('D8-F17: no tab is a peer of a tool that does not exist', () => {
  // This file used to assert the opposite of what follows. Retouch had a tab, a
  // glyph and a label, and its panel said in as many words that nothing behind
  // it changed the photo — so the tests pinned "Retouch is not built yet" and
  // "no control in the app writes to retouch", and both of them were true. They
  // were also a licence for a tab that does nothing to look exactly like a tab
  // that does. The claim D8-F17 was really making is that a tab bar never
  // promises a tool it does not have, and the honest way to hold that now is the
  // other way round: every tab has a panel, and the panel writes the document.
  it('every tab opens a panel of its own, and none falls through to a note', () => {
    expect(PLACEHOLDER_TOOLS).toEqual([])
  })

  it('the retouch tab is the real panel, not a paragraph admitting there is none', () => {
    const text = surface('retouch')
    expect(text).not.toMatch(/not built yet/i)
    expect(text).not.toMatch(/placeholder/i)
    expect(text).toMatch(/Smoothing/)
    expect(text).toMatch(/Heal spot/)
    expect(text).toMatch(/Red-eye/)
  })

  it('no tab renders the placeholder copy, whatever it is called', () => {
    for (const tool of TOOL_IDS) {
      const text = surface(tool)
      expect(text, tool).not.toMatch(/not built yet/i)
      expect(text, tool).not.toMatch(/this tab is a placeholder/i)
      expect(text, tool).not.toMatch(/nothing you can reach here changes the photo/i)
    }
  })
})

describe('D8-F17: what the retouch tab says about itself is a claim about the app', () => {
  // The previous version of this file read the DESCRIPTIONS table out of the
  // source text and asserted on strings that nine of the thirteen tools could
  // never render, because they had grown real panels. That is what let the copy
  // rot: a string no user can see is a string nobody checks, and the table
  // still asserted that the *fonts were missing* and *uploading is not
  // implemented* months after both shipped. So the checks below are about the
  // copy that actually reaches a screen, and about the claim it makes being
  // true — not about the text of a dead map.
  it('exactly one file writes the retouch fields, and it is the panel this tab opens', () => {
    // The old version of this test asserted the mirror image: that *no* file
    // mentioned a writer. It held because the tab was a placeholder, and it would
    // have gone red the moment the panel landed — which is the point of a gate
    // and the reason it is written as a list rather than a "none of these". One
    // writer, in the panel behind the tab, is the state where the tab's copy and
    // the app agree.
    expect(retouchWriters()).toEqual(['src/components/tools/RetouchPanel.tsx'])
  })

  it('the panel the tab opens is the file that writes the fields', () => {
    const source = surfaceSource()
    expect(source).toMatch(/case 'retouch':\s*\n\s*panel = <RetouchPanel/)
    expect(source).toMatch(/import \{ RetouchPanel \} from '\.\.\/tools\/RetouchPanel'/)
  })

  it('no description survives for a tool that has a real panel', () => {
    // Guards the rot itself: a table entry for a tool with a panel is a string
    // no user can see, and a string no user can see stops being true.
    const file = surfaceSource()
    const block = file.slice(
      file.indexOf('const DESCRIPTIONS'),
      file.indexOf('export function ToolSurface'),
    )
    for (const tool of Object.keys(TOOL_COMPONENT)) {
      expect(block, tool).not.toMatch(new RegExp(`\\n  ${tool}:`))
    }
  })
})

describe('the fallback names an absence and promises no date', () => {
  // Unreachable from `surface()` now that every tool has a panel, and that is
  // the assertion: the paragraph this used to render for Retouch is now dead
  // code with no caller, so it can only rot into a claim nothing can check. It
  // is still checked here, because the moment a fourteenth tab lands without a
  // panel this string is the first thing a user reads.
  it('no tool falls through to it, and it is empty', () => {
    expect(PLACEHOLDER_TOOLS).toEqual([])
    const file = surfaceSource()
    const block = file.slice(
      file.indexOf('const DESCRIPTIONS'),
      file.indexOf('export function ToolSurface'),
    )
    expect(block).toMatch(/Partial<Record<ToolId, ToolEmpty>>\s*=\s*\{\}/)
  })

  it('the fallback names the absence and promises no date', () => {
    // `Coming soon.` was the fallback and it is a schedule claim: nothing in
    // this file can know when a panel will exist, and a string that promises one
    // is a string that goes stale silently. The claim is asserted against the
    // source rather than a render, because a component is not reachable here —
    // a comment is allowed to quote the old string, and a component is not.
    const code = surfaceSource()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    expect(code).not.toMatch(/Coming soon|soon\.|almost/i)
    expect(code).toMatch(/No panel for this tool yet/)
  })
})

describe('every sheet title is a name the panel earns', () => {
  /** The title the sheet actually rendered: `BottomSheet` puts it on the dialog. */
  const sheetTitle = (tool: ToolId) => {
    surface(tool)
    const dialog = harness.container.querySelector('[role="dialog"]')
    return dialog?.getAttribute('aria-label') ?? ''
  }

  /**
   * The tab's own name, read out of `ToolTabBar.tsx`.
   *
   * Not the `ToolId`: `filters` is still the id, and the tab is called "Looks",
   * so a title checked against the id would be checking a name the user never
   * sees. The claim under test is about names, and the name of a tool is its tab.
   */
  const tabLabel = (tool: ToolId): string => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/editor/ToolTabBar.tsx'),
      'utf8',
    )
    const match = source.match(new RegExp(`\\b${tool}:\\s*\\{\\s*label:\\s*'([^']+)'`))
    return match?.[1] ?? ''
  }

  it('a title is never an abbreviation of its own tool', () => {
    // "BG" was the tab; "Background" is the sheet. This asserts the sheet side,
    // so renaming one without the other fails here rather than in a screenshot.
    for (const tool of TOOL_IDS) {
      const title = sheetTitle(tool)
      const tab = tabLabel(tool)
      expect(title.length, tool).toBeGreaterThan(0)
      expect(tab.length, tool).toBeGreaterThan(0)
      if (tool === 'crop') continue // deliberately longer: it ships Straighten
      expect(title.toLowerCase(), tool).toContain(tab.toLowerCase())
    }
  })

  it('the titles are unique, so no two panels answer to the same name', () => {
    const titles = TOOL_IDS.map(sheetTitle)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('the tab and the sheet agree on every name, so no panel is renamed on the way in', () => {
    const tabBar = readFileSync(
      resolve(process.cwd(), 'src/components/editor/ToolTabBar.tsx'),
      'utf8',
    )
    const labels = new Map<string, string>(
      [...tabBar.matchAll(/(\w+):\s*\{\s*label:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
    )
    expect(labels.size).toBe(TOOL_IDS.length)
    for (const tool of TOOL_IDS) {
      const tab = labels.get(tool) ?? ''
      const title = sheetTitle(tool)
      // "Crop" vs "Crop & Straighten" is the one intended widening; it is
      // allowed only because the panel really does ship the straighten dial.
      if (tool === 'crop') {
        expect(title.startsWith(tab)).toBe(true)
        continue
      }
      expect(title, tool).toBe(tab)
    }
  })

  it('the looks tool is called Looks on both surfaces', () => {
    // "Filters" was the tab, the sheet title and the shortcut table, over a panel
    // whose own heading said LOOKS. The id stays `filters`; the name does not.
    expect(tabLabel('filters')).toBe('Looks')
    expect(sheetTitle('filters')).toBe('Looks')
  })

  it('"Crop & Straighten" names a control the panel actually has', () => {
    // The one title that is longer than its tab is a claim, so it gets checked
    // against the panel's source rather than trusted.
    const crop = readFileSync(resolve(process.cwd(), 'src/components/tools/CropPanel.tsx'), 'utf8')
    expect(sheetTitle('crop')).toContain('Straighten')
    expect(crop).toMatch(/StraightenDial/)
  })

  it('no panel repeats its own sheet title as a heading ten pixels below it', () => {
    // The audit's first finding: `Looks` then `LOOKS`, `Stickers` then
    // `STICKERS`, in a set of thirteen panels where the other eleven open on a
    // *group* name — Shapes, Watermark, Transform, Frame style, Brush. Two panels
    // naming themselves twice is not a style, it is an inconsistency, and only two
    // panels doing it makes it visible.
    //
    // Read from the rendered DOM rather than from the source: `.sectionTitle` is a
    // CSS-module class whose hash changes with the file, so this finds the headings
    // by their own text — which is the thing the user reads. `Crop` is excluded
    // because "Crop & Straighten" is a *widening* of the tab's name, and the panel
    // below it opens on "Aspect ratio", never on "Crop".
    for (const tool of TOOL_IDS) {
      surface(tool)
      const dialog = harness.container.querySelector('[role="dialog"]')
      const title = dialog?.getAttribute('aria-label') ?? ''
      const headings = Array.from(dialog?.querySelectorAll('p, h3') ?? [])
        .map((node) => (node.textContent ?? '').trim())
        .filter((said) => said.length > 0)
      if (tool === 'crop') continue
      expect(headings, tool).not.toContain(title)
      expect(headings.filter((said) => said === title).length, tool).toBe(0)
    }
  })

  it('the two panels that used to repeat themselves now open on a group', () => {
    // Not "no heading at all": both kept the first thing a reader can act on, which
    // is a group — the Look families and the Shapes row — and neither is its own name.
    surface('filters')
    expect(harness.container.textContent).not.toContain('LOOKS')
    surface('stickers')
    expect(harness.container.textContent).toContain('Shapes')
  })
})

describe('the empty state is one component with one voice', () => {
  it('Text, Redact, Frame and Layers all use the shared empty state', () => {
    // Four panels used to render a private `EmptyState` — a bare paragraph with no
    // heading, declared inside `LayerPanels.tsx` — while Retouch and `ToolSurface`
    // rendered `ui/EmptyState` with a title and a body. Two components with one
    // name and two visible designs in one product.
    for (const tool of ['text', 'redact', 'frame', 'layers'] as ToolId[]) {
      surface(tool)
      const group = harness.container.querySelector('[role="group"][aria-labelledby]')
      // The shared component is a labelled group with an `h3` as its title; the
      // private one was a `div` with a `p` in it and nothing to name it.
      expect(group?.getAttribute('aria-labelledby'), tool).toBeTruthy()
      const titleId = group?.getAttribute('aria-labelledby')
      // The title is a *state*, not the panel's own name: the sheet above already
      // says `Text`, and a heading that says `Text` again is the finding this whole
      // pass is closing.
      expect(harness.container.querySelector(`h3[id="${titleId}"]`)?.textContent, tool).toMatch(
        /^No /,
      )
    }
  })

  it('Draw uses it too, and keeps its button', () => {
    // Draw was the third voice: a `styles.hint` paragraph with a button under it,
    // no heading at all, which is how a panel ends up looking like a different
    // product from the four beside it.
    surface('draw')
    const group = harness.container.querySelector('[role="group"][aria-labelledby]')
    expect(group?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(
      Array.from(harness.container.querySelectorAll('h3')).some(
        (node) => node.textContent === 'No drawing layer yet',
      ),
    ).toBe(true)
    expect(
      Array.from(harness.container.querySelectorAll('button')).some(
        (button) => button.textContent === 'New drawing layer',
      ),
    ).toBe(true)
  })

  it('declares no component named EmptyState outside ui/EmptyState.tsx', () => {
    // The rename fix is only half of it: a second component with the same name is
    // what made the first one invisible. Scanned from disk rather than asserted at
    // the import sites, because the failure mode is a *declaration* somewhere.
    const declarations: string[] = []
    for (const path of tsxSourcesUnder('src')) {
      if (path.endsWith('ui/EmptyState.tsx') || path.includes('.test.')) continue
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      if (/function EmptyState\s*\(/.test(source)) declarations.push(path)
    }
    expect(declarations).toEqual([])
  })
})

describe('a tool with a panel renders controls, not a paragraph of copy', () => {
  it('the crop panel is the real panel', () => {
    const text = surface('crop')
    expect(text).toContain('Aspect')
    expect(text).toContain('Custom ratio')
  })

  it('the retouch panel is the real panel, with the controls the copy names', () => {
    // The paragraph this replaced promised smoothing, healing and red-eye
    // removal and then said none of them could be reached. The three are now
    // controls, so the same three words are checked against controls.
    const text = surface('retouch')
    expect(text).toContain('Skin smoothing')
    expect(text).toContain('Heal spot')
    expect(text).toContain('Red-eye')
    expect(harness.container.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(
      4,
    )
  })

  it('every panel with a real panel behind it is a component, not the fallback', () => {
    for (const tool of Object.keys(TOOL_COMPONENT) as ToolId[]) {
      const text = surface(tool)
      expect(text, tool).not.toMatch(/No panel for this tool yet/)
    }
  })
})
