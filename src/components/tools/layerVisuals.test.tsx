import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDocStore } from '../../store/docStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { useUiStore } from '../../store/uiStore'
import { LayersPanel } from './LayerPanels'

/**
 * The layer row's two numbers, checked against the row that actually renders.
 *
 * `layerVisuals.module.css` argues for `flex-wrap: wrap` with two counts: how
 * many `IconButton`s a selected row *gains*, and how many children the selected
 * row then has. Both are load-bearing — the wrap is only correct if the selected
 * row is the one with a surplus and the unselected row is not — and both went
 * stale the moment Delete moved in with the rest of the selected row's actions,
 * because nothing failed when the comment stopped matching the JSX.
 *
 * A comment is not usually testable, and this one is not testing a comment: it is
 * testing that the two figures the layout argument rests on are still the
 * figures the component has. `responsiveLayout.test.ts` reads
 * `controls.module.css` for exactly this reason, and the `--ie-tap` square the
 * export sheet's colour input was missing for a year is in the same file's
 * teeth. If somebody changes the row, the message tells them the comment moved
 * too, which is the only thing that makes the comment worth writing.
 */

const SHEET = readFileSync(
  resolve(process.cwd(), 'src/components/tools/layerVisuals.module.css'),
  'utf8',
)

/** The comment block immediately above `selector`, as one string. */
function commentAbove(selector: string): string {
  const at = SHEET.indexOf(`\n${selector} {`)
  if (at < 0) throw new Error(`${selector} is not in layerVisuals.module.css`)
  const block = SHEET.slice(0, at)
  const start = block.lastIndexOf('/*')
  if (start < 0) throw new Error(`${selector} has no comment above it`)
  return block.slice(start)
}

/** The first count the comment states, matched on a phrase unique to it. */
function countIn(selector: string, phrase: RegExp): number {
  const said = new RegExp(phrase.source, 'i').exec(commentAbove(selector))
  if (!said) throw new Error(`${selector}'s comment no longer says ${phrase}`)
  const words: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
  }
  return words[(said[1] ?? '').toLowerCase()] ?? Number(said[1])
}

const harness = createHarness()

const WATERMARK = {
  id: 'w1',
  kind: 'watermark' as const,
  name: 'Watermark',
  visible: true,
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' as const },
  text: '© Your Company Name',
  fontId: 'inter',
  color: '#ffffff',
  assetId: null,
  anchor: 'bottom-right' as const,
  tiled: false,
}

const STICKER = {
  id: 's1',
  kind: 'sticker' as const,
  name: 'Sticker',
  visible: true,
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' as const },
  svg: '<svg xmlns="http://www.w3.org/2000/svg" />',
  assetId: 'asset_sticker',
  locked: false,
}

/** The layer row whose name button says `name`, and the children it holds. */
function rowFor(name: string): HTMLElement {
  // A row's name is `layerRowName`, so a watermark reads "Watermark · © Your
  // Company Name" rather than just its name. Matched on a substring for that
  // reason, and the two names below are each unique inside the list.
  const button = Array.from(harness.container.querySelectorAll('button')).find((node) =>
    (node.textContent ?? '').includes(name),
  )
  const row = button?.closest<HTMLElement>('[class*="listItem"]')
  if (!row) throw new Error(`no layer row for ${name}`)
  return row
}

beforeEach(() => {
  resetStores()
  act(() => {
    useDocStore
      .getState()
      .update((doc) => ({ ...doc, layers: [WATERMARK, STICKER] }), { key: 'paste' })
    useUiStore.getState().selectLayer('w1')
  })
  harness.render(<LayersPanel />)
})

afterEach(() => harness.unmount())

describe('the layer row counts in layerVisuals.module.css are the counts', () => {
  it('the selected row has the nine children the comment says it has', () => {
    const selected = rowFor('Watermark')
    const unselected = rowFor('Sticker')

    const children = (row: HTMLElement) =>
      Array.from(row.children).filter((child) => child.tagName !== 'SCRIPT')
    expect(children(selected)).toHaveLength(countIn('.listItem', /(nine|…) children including/))
    expect(children(unselected)).toHaveLength(countIn('.rowName', /(four|…) children/))
  })

  it('a selected row gains the five controls the comment says it gains', () => {
    const selected = rowFor('Watermark')
    const unselected = rowFor('Sticker')
    const gains =
      selected.querySelectorAll('button').length - unselected.querySelectorAll('button').length

    // "gains five `IconButton`s when it is selected" — the name is a button too
    // and is in both rows, so the difference is the selected-only controls.
    expect(gains).toBe(countIn('.listItem', /gains (five|four|…) `IconButton`s/))
    // And they are the five the comment calls out by name, so a number that
    // happens to match cannot be the only thing holding it up.
    for (const label of [
      'Rename layer',
      'Duplicate layer',
      'Bring to front',
      'Send to back',
      'Delete layer',
    ]) {
      expect(
        selected.querySelector(`[aria-label="${label}"]`),
        `${label} is on the selected row`,
      ).not.toBeNull()
      expect(
        unselected.querySelector(`[aria-label="${label}"]`),
        `${label} must not be on an unselected row`,
      ).toBeNull()
    }
    // Reorder is the reverse of that: it stays on every row, because it is the
    // reversible one. It is the reason "the row is the selection" is not the
    // whole story about what an unselected row holds.
    for (const label of ['Move up', 'Move down', 'Hide layer']) {
      expect(unselected.querySelector(`[aria-label="${label}"]`), label).not.toBeNull()
    }
  })
})
