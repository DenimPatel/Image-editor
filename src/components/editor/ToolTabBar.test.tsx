import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, resetStores } from '../../store/testHarness'
import { TOOL_IDS, useUiStore } from '../../store/uiStore'
import { ToolTabBar } from './ToolTabBar'

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
