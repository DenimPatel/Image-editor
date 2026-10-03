import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOOL_IDS } from '../../store/uiStore'
import {
  SHORTCUTS,
  TOOL_SHORTCUTS,
  detectedPlatform,
  isApplePlatform,
  modifierLabel,
  shortcutRows,
  toolShortcutKeys,
  unknownToolShortcuts,
} from './shortcuts'

const HOOK = readFileSync(resolve(process.cwd(), 'src/hooks/useKeyboardShortcuts.ts'), 'utf8')

/**
 * Every key the hook actually reacts to: `case` labels, `event.key === '...'`
 * guards and the `event.key.toLowerCase() === '...'` modifier chords.
 */
function handledKeys(): string[] {
  const patterns = [
    /case '((?:[^'\\]|\\.)+)'/g,
    /event\.key === '((?:[^'\\]|\\.)+)'/g,
    /event\.key\.toLowerCase\(\) === '((?:[^'\\]|\\.)+)'/g,
  ]
  const keys: string[] = []
  for (const pattern of patterns) {
    for (const match of HOOK.matchAll(pattern)) keys.push(match[1].replace(/\\(.)/g, '$1'))
  }
  return keys
}

/** The keys in the hook's `TOOL_KEYS` record. */
function toolKeys(): string[] {
  const block = HOOK.match(/TOOL_KEYS[^=]*=\s*\{([^}]*)\}/)
  if (!block) throw new Error('no TOOL_KEYS in useKeyboardShortcuts')
  return [...block[1].matchAll(/([a-z0-9])\s*:/g)].map((match) => match[1])
}

describe('D8-F15: the help table matches the shortcut implementation', () => {
  it('every rendered row maps to a key the hook switch handles', () => {
    const handled = handledKeys()
    for (const shortcut of SHORTCUTS) {
      expect(
        handled,
        `help lists "${shortcut.key}" (${shortcut.label}) but the hook has no such case`,
      ).toContain(shortcut.key)
    }
  })

  it('every tool shortcut matches TOOL_KEYS in the hook', () => {
    expect(TOOL_SHORTCUTS.map((entry) => entry.key)).toEqual(toolKeys())
  })

  it('the tool shortcuts all name real tools', () => {
    expect(unknownToolShortcuts()).toEqual([])
    for (const entry of TOOL_SHORTCUTS) expect(TOOL_IDS).toContain(entry.tool)
  })

  it('the hook accepts Ctrl as well as Command, so the help says so off Apple', () => {
    expect(HOOK).toMatch(/metaKey\s*\|\|\s*(event\.)?ctrlKey/)
    expect(modifierLabel('Win32')).toBe('Ctrl')
    expect(modifierLabel('Linux x86_64')).toBe('Ctrl')
    expect(modifierLabel('MacIntel')).toBe('⌘')
    expect(modifierLabel('iPhone')).toBe('⌘')
  })

  it('renders Ctrl chords with a + separator and Command chords without', () => {
    const mac = shortcutRows('MacIntel')
    const win = shortcutRows('Win32')
    expect(mac.find((row) => row.label === 'Undo')?.keys).toBe('⌘z')
    expect(win.find((row) => row.label === 'Undo')?.keys).toBe('Ctrl+z')
    expect(mac.find((row) => row.label === 'Redo')?.keys).toBe('⌘⇧z')
    expect(win.find((row) => row.label === 'Redo')?.keys).toBe('Ctrl+Shift+z')
  })

  it('collapses the five tool keys into one row', () => {
    expect(toolShortcutKeys()).toBe(TOOL_SHORTCUTS.map((entry) => entry.key).join(' '))
    const row = shortcutRows('MacIntel')[0]
    expect(row.keys).toBe(toolShortcutKeys())
    expect(row.label).toBe('Crop / Adjust / Text / Draw / Export')
  })

  it('does not claim a fit-to-screen shortcut that does not exist', () => {
    const rows = shortcutRows('MacIntel')
    const zoom = rows.filter((row) => row.keys === '0' || row.keys === '1')
    expect(zoom.map((row) => row.label)).toEqual(['Reset zoom and pan', 'Zoom to 100%'])
    expect(HOOK).toMatch(/case '0':[\s\S]{0,80}?resetViewport\(\)/)
    expect(HOOK).toMatch(/case '1':[\s\S]{0,80}?setViewport\(\{ scale: 1 \}\)/)
  })

  it('has no duplicate chord and no duplicate label', () => {
    const rows = shortcutRows('MacIntel').slice(1)
    expect(new Set(rows.map((row) => row.keys)).size).toBe(rows.length)
    expect(new Set(rows.map((row) => row.label)).size).toBe(rows.length)
  })

  it('isApplePlatform and detectedPlatform degrade safely', () => {
    expect(isApplePlatform('macOS')).toBe(true)
    expect(isApplePlatform('Windows')).toBe(false)
    expect(isApplePlatform('')).toBe(false)
    expect(typeof detectedPlatform()).toBe('string')
  })
})
