import { act, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness } from '../../store/testHarness'
import { SegmentedControl } from './SegmentedControl'

const harness = createHarness()

const OPTIONS = [
  { value: 'sliders', label: 'Sliders' },
  { value: 'curves', label: 'Curves' },
  { value: 'hsl', label: 'Color Mix' },
]

const buttons = () => Array.from(harness.container.querySelectorAll('button'))

function press(target: Element, k: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

function Controlled({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('sliders')
  return (
    <SegmentedControl
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
      ariaLabel="Section"
    />
  )
}

afterEach(() => harness.unmount())

describe('D8-F11: SegmentedControl is a group of toggles, not a tablist', () => {
  it('declares a group and no tab roles', () => {
    harness.render(
      <SegmentedControl
        options={OPTIONS}
        value="sliders"
        onChange={() => {}}
        ariaLabel="Section"
      />,
    )
    const group = harness.container.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-label')).toBe('Section')
    expect(harness.container.querySelector('[role="tablist"]')).toBeNull()
    expect(harness.container.querySelector('[role="tab"]')).toBeNull()
    for (const button of buttons()) {
      expect(button.hasAttribute('aria-pressed')).toBe(true)
      expect(button.hasAttribute('aria-selected')).toBe(false)
    }
  })

  it('marks exactly the chosen value as pressed', () => {
    harness.render(
      <SegmentedControl options={OPTIONS} value="curves" onChange={() => {}} ariaLabel="Section" />,
    )
    const pressed = buttons().filter((button) => button.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0].textContent).toBe('Curves')
  })

  it('has one tab stop: the selected option', () => {
    harness.render(
      <SegmentedControl options={OPTIONS} value="curves" onChange={() => {}} ariaLabel="Section" />,
    )
    const tabIndexes = buttons().map((button) => button.tabIndex)
    expect(tabIndexes).toEqual([-1, 0, -1])
  })

  it('arrow keys move the selection and the focus together', () => {
    const changes: string[] = []
    harness.render(<Controlled onChange={(value) => changes.push(value)} />)
    press(buttons()[0], 'ArrowRight')
    expect(changes).toEqual(['curves'])
    expect(document.activeElement).toBe(buttons()[1])
    expect(buttons().map((button) => button.tabIndex)).toEqual([-1, 0, -1])

    press(buttons()[1], 'ArrowRight')
    expect(changes[changes.length - 1]).toBe('hsl')
    expect(document.activeElement).toBe(buttons()[2])

    press(buttons()[2], 'ArrowRight')
    expect(changes[changes.length - 1]).toBe('sliders')
    expect(document.activeElement).toBe(buttons()[0])

    press(buttons()[0], 'ArrowLeft')
    expect(changes[changes.length - 1]).toBe('hsl')

    press(buttons()[2], 'Home')
    expect(changes[changes.length - 1]).toBe('sliders')
    expect(document.activeElement).toBe(buttons()[0])

    press(buttons()[0], 'End')
    expect(changes[changes.length - 1]).toBe('hsl')
    expect(document.activeElement).toBe(buttons()[2])
  })

  it('ignores keys that are not part of the pattern', () => {
    const changes: string[] = []
    harness.render(
      <SegmentedControl
        options={OPTIONS}
        value="sliders"
        onChange={(value) => changes.push(value)}
        ariaLabel="Section"
      />,
    )
    for (const k of ['a', 'Enter', ' ', 'PageDown']) press(buttons()[0], k)
    expect(changes).toEqual([])
  })

  it('still selects on click', () => {
    const changes: string[] = []
    harness.render(
      <SegmentedControl
        options={OPTIONS}
        value="sliders"
        onChange={(value) => changes.push(value)}
        ariaLabel="Section"
      />,
    )
    act(() => buttons()[2].click())
    expect(changes).toEqual(['hsl'])
  })

  it('survives an empty option list', () => {
    harness.render(<SegmentedControl options={[]} value="none" onChange={() => {}} />)
    expect(harness.container.querySelector('[role="group"]')).not.toBeNull()
    expect(buttons()).toHaveLength(0)
  })
})
