import { act } from 'react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ADJUST_SPECS } from '../../model/defaults'
import type { AdjustKey } from '../../model/types'
import { useUiStore } from '../../store/uiStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { ParameterRow } from './ParameterRow'

const harness = createHarness()

const items = ADJUST_SPECS.map((spec) => ({
  key: spec.key,
  label: spec.label,
  value: 0,
  min: spec.min,
  max: spec.max,
  neutral: spec.neutral,
  unit: spec.unit,
}))

const rings = () =>
  Array.from(harness.container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'))

function press(target: Element, k: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

function Controlled() {
  const [selected, setSelected] = useState<AdjustKey | null>('exposure')
  return <ParameterRow items={items} selectedKey={selected} onSelect={setSelected} />
}

afterEach(() => harness.unmount())

describe('D8-F11: ParameterRow is a toolbar of toggles, not a tablist', () => {
  it('declares a toolbar and never a tablist with unowned children', () => {
    resetStores()
    harness.render(<Controlled />)
    const toolbar = harness.container.querySelector('[role="toolbar"]')
    expect(toolbar?.getAttribute('aria-orientation')).toBe('horizontal')
    expect(toolbar?.getAttribute('aria-label')).toBe('Adjustment parameters')
    // The old markup was role="tablist" over aria-pressed buttons, which is the
    // aria-required-children violation axe reports.
    expect(harness.container.querySelector('[role="tablist"]')).toBeNull()
    expect(harness.container.querySelector('[role="tab"]')).toBeNull()
    expect(rings()).toHaveLength(items.length)
  })

  it('exposes each ring as a pressed toggle with a readable name', () => {
    harness.render(<Controlled />)
    const first = rings()[0]
    expect(first.getAttribute('aria-pressed')).toBe('true')
    expect(first.getAttribute('aria-label')).toMatch(/^Exposure /)
    // The visual label/value spans are hidden from assistive tech so the
    // button's own aria-label is not read twice.
    expect(first.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
  })

  it('has exactly one tab stop, on the selected ring', () => {
    harness.render(<Controlled />)
    const tabIndexes = rings().map((ring) => ring.tabIndex)
    expect(tabIndexes.filter((value) => value === 0)).toHaveLength(1)
    expect(rings()[0].tabIndex).toBe(0)
  })

  it('arrow keys move the selection, the tab stop and the focus together', () => {
    harness.render(<Controlled />)
    press(rings()[0], 'ArrowRight')
    expect(useUiStore.getState().selectedAdjustKey).toBe('exposure')
    const pressed = rings().filter((ring) => ring.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0].getAttribute('aria-label')).toMatch(/^Brilliance /)
    expect(document.activeElement).toBe(pressed[0])
    expect(pressed[0].tabIndex).toBe(0)
  })

  it('End jumps to the last ring and Home back to the first', () => {
    harness.render(<Controlled />)
    press(rings()[0], 'End')
    const last = rings()[items.length - 1]
    expect(last.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(last)
    press(last, 'Home')
    expect(rings()[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('ignores ArrowUp/ArrowDown in a horizontal row and any other key', () => {
    harness.render(<Controlled />)
    for (const k of ['ArrowDown', 'ArrowUp', 'a', 'Enter', ' ']) press(rings()[0], k)
    expect(rings()[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('a null selection still leaves one tab stop', () => {
    harness.render(<ParameterRow items={items} selectedKey={null} onSelect={() => {}} />)
    expect(rings().filter((ring) => ring.tabIndex === 0)).toHaveLength(1)
    expect(rings()[0].tabIndex).toBe(0)
  })

  it('selects on click', () => {
    const selected: AdjustKey[] = []
    harness.render(
      <ParameterRow items={items} selectedKey="exposure" onSelect={(k) => selected.push(k)} />,
    )
    act(() => rings()[2].click())
    expect(selected).toEqual([items[2].key])
  })

  it('formats the value into the ring label', () => {
    harness.render(
      <ParameterRow
        items={items.map((item, index) => (index === 0 ? { ...item, value: 1.25 } : item))}
        selectedKey="exposure"
        onSelect={() => {}}
      />,
    )
    expect(rings()[0].getAttribute('aria-label')).toBe('Exposure +1.3EV')
  })
})
