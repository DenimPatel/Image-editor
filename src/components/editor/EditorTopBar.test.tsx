import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { EditorTopBar } from './EditorTopBar'

const harness = createHarness()

const noop = () => {}

function render(props: Partial<Parameters<typeof EditorTopBar>[0]> = {}) {
  harness.render(
    <EditorTopBar
      title="Sample 1"
      onClose={noop}
      onDone={noop}
      onReset={noop}
      onCopyEdits={noop}
      onPasteEdits={noop}
      onSavePreset={noop}
      onInfo={noop}
      onShowHelp={noop}
      onNewImage={noop}
      canPaste
      {...props}
    />,
  )
}

const trigger = () => harness.container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
const items = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
const open = () => act(() => trigger()?.click())
const doneButton = () =>
  Array.from(harness.container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Done',
  )

function press(target: Element, k: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

beforeEach(() => resetStores())
afterEach(() => harness.unmount())

describe('D8-F11: the overflow menu is a real popover', () => {
  it('the trigger declares the menu relationship up front', () => {
    render()
    const button = trigger()
    expect(button?.getAttribute('aria-haspopup')).toBe('menu')
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(button?.getAttribute('aria-controls')).toBeNull()
    expect(menu()).toBeNull()
  })

  it('opening wires aria-expanded and aria-controls to the rendered menu', () => {
    render()
    open()
    const button = trigger()
    expect(button?.getAttribute('aria-expanded')).toBe('true')
    expect(button?.getAttribute('aria-controls')).toBe(menu()?.id)
    expect(menu()?.getAttribute('aria-label')).toBe('More options')
  })

  it('every entry is a menuitem and the unavailable one is disabled', () => {
    render({ canPaste: false })
    open()
    expect(items().map((item) => item.textContent)).toEqual([
      'Keyboard shortcuts',
      'Appearance…',
      'New image',
      'Reset all edits',
      'Copy edits',
      'Paste edits',
      'Save preset…',
      'Photo details',
    ])
    // Located by name, not by position: an index is a statement about the array,
    // and the array is not what this is about.
    const paste = items().find((item) => item.textContent === 'Paste edits')
    expect(paste?.disabled).toBe(true)
    expect(paste?.getAttribute('aria-disabled')).toBe('true')
  })

  it('offers New image, in its own group, with a reason when it cannot be pressed', () => {
    // The row that closes D-01. Its name is fixed by the acceptance criterion, so
    // it is asserted exactly rather than by prefix: an accessible name that drifts
    // by an ellipsis or a trailing "…" breaks every keyboard route to it.
    const onNewImage = vi.fn()
    render({ onNewImage })
    open()
    const item = items().find((node) => node.textContent === 'New image')
    expect(item?.getAttribute('role')).toBe('menuitem')
    expect(item?.getAttribute('aria-disabled')).toBeNull()
    act(() => item?.click())
    expect(onNewImage).toHaveBeenCalledOnce()
    expect(menu()).toBeNull()

    // Its own group: it is the only row that is neither an editor setting nor an
    // edit to this photo, so it is separated from both rather than filed under
    // either. Three separators for eight rows in three blocks.
    render({ onNewImage })
    open()
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(3)
  })

  it('keeps New image in the menu while an export is running, and says why', () => {
    // A row that disappears while the user is working reads as a broken menu. A row
    // that greys out with no stated reason is the same dead end as a dead button,
    // so the reason travels as an accessible description rather than in the label.
    render()
    useUiStore.getState().setExportBusy(true)
    open()
    const item = items().find((node) => node.textContent === 'New image')
    expect(item).toBeDefined()
    expect(item?.disabled).toBe(true)
    expect(item?.getAttribute('aria-disabled')).toBe('true')
    const describedBy = item?.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')?.textContent).toContain('export is running')
    // The name still says only what the row does: a reason in the label would
    // break WCAG 3.2.4, the defect the Compare toggle had.
    expect(item?.textContent).toBe('New image')
  })

  it('opens the appearance panel, which is the only way to reach six settings', () => {
    // It is a menu item rather than a fourteenth tool tab: a tab would cost a
    // TOOL_IDS entry, a TITLES entry, a META entry and a glyph, and would make
    // an already-scrolling thirteen-item tab bar worse.
    render()
    expect(document.querySelector('[role="dialog"][aria-labelledby]')).toBeNull()
    open()
    const appearance = items()[1]
    expect(appearance.textContent).toBe('Appearance…')
    act(() => appearance.click())
    expect(menu()).toBeNull()

    const panel = document.querySelector('[role="dialog"]')
    expect(panel?.getAttribute('aria-modal')).toBe('false')
    // Every setting, as a real control with a real name.
    const names = Array.from(panel?.querySelectorAll('input[type="radio"]') ?? []).map((radio) =>
      radio.getAttribute('aria-label'),
    )
    expect(names).toHaveLength(19)
    expect(new Set(names).size).toBe(19)
  })

  it('the appearance panel is a sibling of the header, not inside it', () => {
    render()
    open()
    act(() => items()[1].click())
    const header = harness.container.querySelector('header')
    expect(header?.contains(document.querySelector('[role="dialog"]') as Node)).toBe(false)
    // The top bar is a stacking context at 30 and the desktop inspector sits at
    // 41, so a panel inside the bar would paint under it.
    expect(document.querySelector('[role="dialog"]')?.parentElement).toBe(header?.parentElement)
  })

  it('the help overlay is reachable from a menu, not only from the ? key', () => {
    // It used to have no button at all, so the shortcut table existed for the
    // handful of users who already knew it was there.
    const onShowHelp = vi.fn()
    render({ onShowHelp })
    open()
    const help = items()[0]
    expect(help.textContent).toBe('Keyboard shortcuts')
    act(() => help.click())
    expect(onShowHelp).toHaveBeenCalledOnce()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('the popover is a sibling of the header, not inside it', () => {
    render()
    open()
    // The top bar is a stacking context at z-index 30 and the desktop
    // inspector sits at 41, so a popover inside the bar would paint under it.
    expect(harness.container.querySelector('header [role="menu"]')).toBeNull()
    const header = harness.container.querySelector('header')
    expect(menu()?.parentElement).toBe(header?.parentElement)
  })

  it('focus moves to the first item on open', () => {
    render()
    open()
    expect(document.activeElement).toBe(items()[0])
  })

  it('ArrowDown on the trigger opens the menu', () => {
    render()
    act(() => trigger()?.focus())
    press(trigger() as Element, 'ArrowDown')
    expect(menu()).not.toBeNull()
  })

  it('arrow keys rove and skip the disabled item', () => {
    render({ canPaste: false })
    open()
    press(items()[0], 'ArrowDown')
    expect(document.activeElement).toBe(items()[1])
    press(items()[1], 'ArrowDown')
    expect(document.activeElement).toBe(items()[2])
    press(items()[2], 'ArrowDown')
    expect(document.activeElement).toBe(items()[3])
    press(items()[3], 'ArrowDown')
    expect(document.activeElement).toBe(items()[4])
    // 'Paste edits' is disabled here, so focus steps over it rather than stopping
    // on a control that cannot be pressed.
    expect(document.activeElement).not.toBe(items()[5])
    press(items()[4], 'ArrowDown')
    expect(document.activeElement).toBe(items()[6])
    press(items()[6], 'ArrowDown')
    expect(document.activeElement).toBe(items()[7])
    press(items()[7], 'ArrowDown')
    expect(document.activeElement).toBe(items()[0])
    press(items()[0], 'ArrowUp')
    expect(document.activeElement).toBe(items()[7])
    press(items()[7], 'Home')
    expect(document.activeElement).toBe(items()[0])
    press(items()[0], 'End')
    expect(document.activeElement).toBe(items()[7])
  })

  it('ArrowDown twice lands on New image', () => {
    // The row's position is a design decision worth pinning: it is the third thing
    // in the menu, after the editor's own settings and before anything that edits
    // this photo, because it is neither.
    render()
    open()
    // Focus is already on the first row when the menu opens, so the third row is
    // two presses away.
    press(items()[0], 'ArrowDown')
    press(items()[1], 'ArrowDown')
    expect(document.activeElement).toBe(items()[2])
    expect(items()[2].textContent).toBe('New image')
  })

  it('Escape closes and hands focus back to the trigger', () => {
    render()
    open()
    press(items()[0], 'Escape')
    expect(menu()).toBeNull()
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })

  it('Tab closes the menu so focus can leave it', () => {
    render()
    open()
    press(items()[0], 'Tab')
    expect(menu()).toBeNull()
  })

  it('an outside press dismisses without stealing focus', () => {
    render()
    open()
    const outside = doneButton()
    expect(outside).toBeDefined()
    act(() => {
      outside?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })
    expect(menu()).toBeNull()
    expect(document.activeElement).not.toBe(trigger())
  })

  it('focus moving outside dismisses the menu', () => {
    render()
    open()
    act(() => doneButton()?.focus())
    expect(menu()).toBeNull()
  })

  it('clicking an item runs it, closes, and restores focus', () => {
    const info = vi.fn()
    render({ onInfo: info })
    open()
    // Addressed by name rather than by position: `items()[items().length - 1]`
    // asserts only that *whatever is last* was clicked, which is a statement
    // about the array, not about the control.
    const infoItem = items().find((item) => item.textContent === 'Photo details')
    act(() => infoItem?.click())
    expect(info).toHaveBeenCalledOnce()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('the trigger toggles closed on a second click', () => {
    render()
    open()
    open()
    expect(menu()).toBeNull()
  })

  it('shows live Undo/Redo enablement from the document store', () => {
    render()
    const undo = harness.container.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')
    const redo = harness.container.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')
    expect(undo?.disabled).toBe(true)
    expect(redo?.disabled).toBe(true)
    act(() => {
      useUiStore.getState().pushToast('noop')
    })
    expect(
      harness.container.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')?.disabled,
    ).toBe(true)
  })
})

/**
 * The file name, and the two things that have to be true about it in jsdom.
 *
 * jsdom computes no layout, so nothing here can say which end of the name an
 * ellipsis falls at — that is `journey.responsive.spec.ts` and
 * `journey.panel-seams.spec.ts`, measuring in Chromium and WebKit. What jsdom *can*
 * say is that the name is whole in the document, that the tooltip carries all of
 * it, and that it sits inside a `<bdi>`: the box is RTL so the ellipsis lands at
 * the start and the identifying end survives, and the isolate is what stops an RTL
 * box from reordering a Latin file name. Drop the `<bdi>` and nothing here fails
 * until a browser paints one wrong.
 */
describe('the file name in the bar', () => {
  const title = () => {
    render()
    return harness.container.querySelector<HTMLElement>('header span[title]')
  }

  it('keeps the name whole in the element and whole in the tooltip', () => {
    render({ title: 'Screenshot 2026-10-03 at 14.22.51.png' })
    const node = harness.container.querySelector<HTMLElement>('header span[title]')
    expect(node?.textContent).toBe('Screenshot 2026-10-03 at 14.22.51.png')
    // `text-overflow` never changes `textContent`, so this is also the statement
    // that whatever the box does to the line, it does not do it to the name.
    expect(node?.getAttribute('title')).toBe('Screenshot 2026-10-03 at 14.22.51.png')
    // A one-word name is still a name, and the tooltip is still there for it.
    render({ title: 'a' })
    expect(harness.container.querySelector('header span[title]')?.getAttribute('title')).toBe('a')
  })

  it('puts the name inside a <bdi>, which is what makes an RTL box safe for it', () => {
    const node = title()
    const run = node?.querySelector('bdi')
    expect(run).not.toBeNull()
    expect(run?.textContent).toBe('Sample 1')
    // One text run, not one text node per character: a name assembled from
    // fragments is a name a clip could cut between.
    expect(run?.childNodes).toHaveLength(1)
  })

  it('clips at the start above 420px and at the end below it, and both rules are in the stylesheet', () => {
    // The one thing jsdom cannot measure is recorded here as the decision it is:
    // two defects, two fixes, and the width that separates them. An RTL box puts
    // the ellipsis at the start, which keeps the identifying end of a file name on
    // screen; below 420px the ellipsis lands against the overflow button's own
    // three dots — measured at 360px with Roomy density and Extra-large text, the
    // bar painted "…le 1" 8px from "•••" and the two read as one control — so the
    // box flips to LTR there and the name is cut at its end instead.
    //
    // Asserted against the stylesheet rather than the DOM because the DOM has no
    // layout to assert: this is the mechanism, and `journey.responsive.spec.ts` is
    // the outcome in two engines.
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/editor/editor.module.css'),
      'utf8',
    )
    const titleBlock = css.slice(css.indexOf('.topBarTitle {'))
    expect(titleBlock).toMatch(/direction:\s*rtl/)
    // Not `text-align: center` in the same block: a centred line is clipped at both
    // ends, which is the outcome with no characters in it at all.
    expect(titleBlock.slice(0, titleBlock.indexOf('}'))).not.toMatch(/text-align:\s*center/)
    // And the narrow-phone flip, which is the fix for the dots and the only place
    // the front ellipsis is given up.
    const narrow = css.slice(css.indexOf('@media (max-width: 420px)'))
    expect(narrow).toMatch(/direction:\s*ltr/)
  })
})
