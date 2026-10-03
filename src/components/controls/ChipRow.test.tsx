import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness } from '../../store/testHarness'
import { ChipRow } from './ChipRow'
import { RatioChipRow } from './RatioChip'
import styles from './controls.module.css'
import shapeStyles from '../tools/ratioChips.module.css'

/**
 * The two chip rows share one shell, so this file asserts the thing the
 * extraction was for: that the edge fade behaves identically in both, because
 * there is one measurement behind it rather than one per row.
 *
 * It used to be two. `RatioChipRow` re-declared the shell to fit a glyph slot
 * around its labels, which meant a change to the fade had to be made twice and
 * verified twice, and there was no test on the text-only row at all to catch the
 * case where only one of the two got it.
 */

const harness = createHarness()

const OPTIONS = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
  { value: 'three', label: 'Three' },
]

const SHAPE_OPTIONS = OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
  shape: { kind: 'viewfinder' as const, ratio: 4 / 5 },
}))

function row(): HTMLElement {
  const found = harness.container.querySelector('[role="group"]')
  if (!found) throw new Error('no chip row')
  return found as HTMLElement
}

function classNames(): string[] {
  return row().className.split(' ')
}

/** jsdom lays nothing out, so the row has to be told what it looks like. */
function measure({ client, scroll, left = 0 }: { client: number; scroll: number; left?: number }) {
  const node = row()
  Object.defineProperty(node, 'clientWidth', { value: client, configurable: true })
  Object.defineProperty(node, 'scrollWidth', { value: scroll, configurable: true })
  Object.defineProperty(node, 'scrollLeft', { value: left, configurable: true, writable: true })
  act(() => {
    node.dispatchEvent(new Event('scroll'))
  })
}

beforeEach(() => {
  harness.render(<ChipRow options={OPTIONS} value="one" onChange={() => {}} ariaLabel="Options" />)
})

afterEach(() => harness.unmount())

describe('the text chip row', () => {
  it('is a group of buttons named by the caller, with one pressed', () => {
    const group = row()
    expect(group.getAttribute('aria-label')).toBe('Options')
    const pressed = Array.from(harness.container.querySelectorAll('[aria-pressed="true"]'))
    expect(pressed.map((button) => button.textContent)).toEqual(['One'])
  })

  it('fades the trailing edge only while there is more to scroll to', () => {
    expect(classNames()).toContain(styles.chipRow)
    expect(classNames()).not.toContain(styles.chipRowMore)

    measure({ client: 100, scroll: 300 })
    expect(classNames()).toContain(styles.chipRowMore)

    // At the end, the last chip really is the last chip, and a gradient over its
    // own label would be a different defect rather than a milder one.
    measure({ client: 100, scroll: 300, left: 200 })
    expect(classNames()).not.toContain(styles.chipRowMore)

    // And a row that does not overflow is not faded on either side of that.
    measure({ client: 300, scroll: 300 })
    expect(classNames()).not.toContain(styles.chipRowMore)
  })

  it('passes a caller class through without losing the fade on top of it', () => {
    harness.render(
      <ChipRow
        options={OPTIONS}
        value="one"
        onChange={() => {}}
        ariaLabel="Options"
        className="caller-supplied"
      />,
    )
    expect(classNames()).toContain('caller-supplied')
    expect(classNames()).toContain(styles.chipRow)
    measure({ client: 100, scroll: 300 })
    expect(classNames()).toEqual(expect.arrayContaining(['caller-supplied', styles.chipRowMore]))
  })
})

describe('the two rows share one fade', () => {
  it('behaves identically, differing only in the class each row styles itself with', () => {
    const observed: boolean[][] = []
    for (const [element, fade] of [
      [
        <ChipRow options={OPTIONS} value="one" onChange={() => {}} ariaLabel="Text" />,
        styles.chipRowMore,
      ],
      [
        <RatioChipRow
          ariaLabel="Shapes"
          options={SHAPE_OPTIONS}
          selected={[]}
          onChange={() => {}}
        />,
        shapeStyles.rowMore,
      ],
    ] as const) {
      harness.render(element)
      const atEnd: boolean[] = []
      measure({ client: 100, scroll: 300, left: 0 })
      atEnd.push(classNames().includes(fade))
      measure({ client: 100, scroll: 300, left: 200 })
      atEnd.push(classNames().includes(fade))
      measure({ client: 300, scroll: 300 })
      atEnd.push(classNames().includes(fade))
      observed.push(atEnd)
    }
    // Overflowing and not at the end: faded. At the end, and not overflowing at
    // all: not faded. The same three answers, from one implementation.
    expect(observed[0]).toEqual([true, false, false])
    expect(observed[1]).toEqual(observed[0])
  })
})
