import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, resetStores } from '../../store/testHarness'
import { TOOL_IDS, useUiStore } from '../../store/uiStore'
import { ToolTabBar } from './ToolTabBar'
import styles from './editor.module.css'

const harness = createHarness()

const tabs = () => Array.from(harness.container.querySelectorAll('button'))
const current = () => harness.container.querySelector('button[aria-current]')?.textContent?.trim()
const tab = (name: string) => tabs().find((node) => node.textContent?.trim() === name)
const tap = (name: string) => act(() => tab(name)?.click())

beforeEach(() => {
  resetStores()
  harness.render(<ToolTabBar />)
})

afterEach(() => harness.unmount())

describe('the tool tab bar', () => {
  it('offers every tool exactly once, by name', () => {
    expect(tabs().map((node) => node.textContent?.trim())).toEqual([
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
    ])
    expect(TOOL_IDS).toHaveLength(tabs().length)
  })

  it('calls the looks tab Looks, and does not leave Filters behind', () => {
    // The orientation panel says "Looks are settings, not filters", and then the
    // tab, the sheet title and the shortcut table all said Filters. Either the
    // tab names the thing the panel teaches or the panel's first sentence is
    // decoration, so the old word has to be gone from the bar entirely.
    expect(tab('Looks')).toBeDefined()
    expect(tab('Filters')).toBeUndefined()
    tap('Looks')
    expect(useUiStore.getState().activeTool).toBe('filters')
  })

  it('marks the open tool as current, once', () => {
    tap('Export')
    expect(current()).toBe('Export')
    expect(harness.container.querySelectorAll('button[aria-current]')).toHaveLength(1)
  })

  it('stays open when the open tab is tapped again', () => {
    // It used to read `active ? null : tool`: a second tap closed the panel and
    // dropped `aria-current`, so the tab stopped saying which tool was open and
    // a user who opened Export to change the format and tapped again to reach
    // Download lost the panel. A tab opens a tool; it is not a toggle.
    tap('Export')
    tap('Export')
    expect(useUiStore.getState().activeTool).toBe('export')
    expect(current()).toBe('Export')
  })

  it('stays open for every tool, not just the one that was reported', () => {
    for (const name of ['Crop', 'Adjust', 'Export', 'Passport', 'Background']) {
      tap(name)
      tap(name)
      expect(useUiStore.getState().activeTool, name).toBeTruthy()
      expect(current(), name).toBe(name)
    }
  })

  it('switching tabs moves the current marker rather than adding one', () => {
    tap('Crop')
    tap('Export')
    expect(current()).toBe('Export')
    expect(harness.container.querySelectorAll('button[aria-current]')).toHaveLength(1)
  })

  it('claims "current", not "page" — no tab navigates anywhere', () => {
    tap('Text')
    expect(tab('Text')?.getAttribute('aria-current')).toBe('true')
  })
})

/**
 * The edges, given the geometry jsdom will not compute.
 *
 * The bar is a scroller and it hides its scrollbar, so a phone user has no way
 * to know eight of thirteen tools are off-screen; at 390px the fifth tab's label
 * was also cut mid-word by the edge. The fade is the affordance for the first
 * and the tightened metrics for the second, and both are decided from these
 * three numbers. Which edge is worth fading is `measureScrollEdges`' business and
 * is pinned in `useScrollEdges.test.ts`; what this file owns is that the bar asks
 * for the right one and puts it on the right edge.
 *
 * jsdom lays nothing out, so `scrollWidth` and `clientWidth` are 0 for every
 * element — a test of "does this bar overflow" written against the DOM without
 * giving it a geometry passes on a bar that overflows by 507px. The geometry
 * itself is measured in `e2e/journey.mobile.spec.ts`.
 */
describe('the tool tab bar says when it scrolls', () => {
  const nav = () => harness.container.querySelector('nav') as HTMLElement

  /** A scroller of a known shape, then the scroll a thumb would leave behind. */
  const measure = ({
    client,
    scroll,
    left = 0,
  }: {
    client: number
    scroll: number
    left?: number
  }) => {
    const bar = nav()
    Object.defineProperty(bar, 'clientWidth', { value: client, configurable: true })
    Object.defineProperty(bar, 'scrollWidth', { value: scroll, configurable: true })
    Object.defineProperty(bar, 'scrollLeft', { value: left, configurable: true, writable: true })
    act(() => {
      bar.dispatchEvent(new Event('scroll'))
    })
  }

  const fades = () => ({
    end: nav().classList.contains(styles.tabBarMoreEnd),
    start: nav().classList.contains(styles.tabBarMoreStart),
  })

  it('fades the trailing edge on a bar that is wider than its box', () => {
    expect(fades()).toEqual({ end: false, start: false })

    measure({ client: 390, scroll: 897 })
    expect(fades()).toEqual({ end: true, start: false })
  })

  it('fades neither edge once the last tool is in view', () => {
    // A fade left on a bar scrolled to the end is a gradient across the last
    // tab's own label, which is a different defect rather than a milder version
    // of the one the fade exists to prevent.
    measure({ client: 390, scroll: 897, left: 507 })
    expect(fades()).toEqual({ end: false, start: true })
  })

  it('fades the leading edge too, once something is behind it', () => {
    measure({ client: 390, scroll: 897, left: 250 })
    expect(fades()).toEqual({ end: true, start: true })
  })

  it('fades nothing at a width where all thirteen fit', () => {
    // The 1280px case, and the reason the fade is measured rather than written:
    // a bar that needs no fade must not carry one.
    measure({ client: 1280, scroll: 1092 })
    expect(fades()).toEqual({ end: false, start: false })
    measure({ client: 1280, scroll: 1092, left: 0 })
    expect(fades()).toEqual({ end: false, start: false })
  })

  it('puts the affordance on the bar and adds no thirteenth-and-a-half control', () => {
    // The fade is a mask on the row rather than a control of its own, so nothing
    // new is in the accessibility tree and no Tab press lands on it. A button
    // here would be a fourteenth tab.
    measure({ client: 390, scroll: 897 })
    expect(nav().querySelectorAll('button')).toHaveLength(TOOL_IDS.length)
    expect(nav().children).toHaveLength(TOOL_IDS.length)
    expect(Array.from(nav().children).every((node) => node.tagName === 'BUTTON')).toBe(true)
  })

  it('keeps the tab order the DOM order, which the fades do not touch', () => {
    measure({ client: 390, scroll: 897, left: 250 })
    expect(tabs().map((node) => node.textContent?.trim())).toEqual([
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
    ])
  })
})
