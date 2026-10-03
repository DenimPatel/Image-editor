import { describe, expect, it } from 'vitest'
import { ROVING_KEYS, nextRovingIndex } from './rovingTabindex'

describe('nextRovingIndex', () => {
  it('moves one step and wraps at both ends', () => {
    expect(nextRovingIndex('ArrowRight', 0, 5)).toBe(1)
    expect(nextRovingIndex('ArrowRight', 4, 5)).toBe(0)
    expect(nextRovingIndex('ArrowLeft', 0, 5)).toBe(4)
    expect(nextRovingIndex('ArrowLeft', 3, 5)).toBe(2)
  })

  it('jumps to the ends with Home and End', () => {
    expect(nextRovingIndex('Home', 3, 5)).toBe(0)
    expect(nextRovingIndex('End', 1, 5)).toBe(4)
  })

  it('ignores keys outside the pattern so the browser keeps them', () => {
    for (const key of ['Enter', ' ', 'a', 'Escape', 'PageDown']) {
      expect(nextRovingIndex(key, 0, 5)).toBeNull()
    }
  })

  it('leaves ArrowUp/ArrowDown alone in a horizontal row', () => {
    expect(nextRovingIndex('ArrowDown', 1, 5, 'horizontal')).toBeNull()
    expect(nextRovingIndex('ArrowUp', 1, 5, 'horizontal')).toBeNull()
    expect(nextRovingIndex('ArrowDown', 1, 5, 'both')).toBe(2)
    expect(nextRovingIndex('ArrowUp', 1, 5, 'both')).toBe(0)
  })

  it('returns null for an empty set rather than 0', () => {
    expect(nextRovingIndex('ArrowRight', 0, 0)).toBeNull()
    expect(nextRovingIndex('Home', 0, 0)).toBeNull()
  })

  it('handles a single item', () => {
    expect(nextRovingIndex('ArrowRight', 0, 1)).toBe(0)
    expect(nextRovingIndex('End', 0, 1)).toBe(0)
  })

  it('exports exactly the six keys the pattern owns', () => {
    expect([...ROVING_KEYS].sort()).toEqual(['ArrowLeft', 'ArrowRight', 'End', 'Home'].sort())
  })
})
