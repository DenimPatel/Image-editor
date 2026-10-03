import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLAGS_STORAGE_KEY, FLAG_IDS, initFlags, resetFlags, setFlagState } from '../../lib/flags'
import { useUiStore } from '../../store/uiStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { SHORTCUT_GROUPS, detectedPlatform, shortcutRows, shortcutSections } from '../ui/shortcuts'
import { HelpOverlay } from './HelpOverlay'

const harness = createHarness()

const panel = () => harness.container.querySelector<HTMLElement>('[role="dialog"]')
const closeButton = () => panel()?.querySelector<HTMLButtonElement>('button')

function pressEscape() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
  })
}

const show = () => act(() => useUiStore.getState().setShowHelp(true))

afterEach(() => harness.unmount())

beforeEach(() => {
  resetStores()
  harness.render(<HelpOverlay />)
})

describe('D8-F15: the help overlay is a real dialog', () => {
  it('renders nothing until it is asked for', () => {
    expect(panel()).toBeNull()
  })

  it('is a labelled modal dialog', () => {
    show()
    const dialog = panel()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    const labelledBy = dialog?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const heading = Array.from(harness.container.querySelectorAll('h2')).find(
      (node) => node.id === labelledBy,
    )
    expect(heading?.textContent).toBe('Keyboard shortcuts')
  })

  it('moves focus to the panel on open and back to the opener on close', () => {
    const opener = document.createElement('button')
    opener.textContent = 'Help'
    document.body.appendChild(opener)
    act(() => opener.focus())

    show()
    expect(document.activeElement).toBe(panel())

    pressEscape()
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('Escape closes it without the editor hook also cancelling the tool', () => {
    act(() => useUiStore.getState().setActiveTool('crop'))
    show()
    const seen: string[] = []
    // Stands in for `useKeyboardShortcuts`, which listens on window in the bubble
    // phase and would cancel the open tool on the same Escape.
    act(() => {
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') seen.push('hook')
      })
    })
    pressEscape()
    expect(panel()).toBeNull()
    expect(seen).toEqual([])
    expect(useUiStore.getState().activeTool).toBe('crop')
  })

  it('closes from the Close button and returns focus', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    act(() => opener.focus())
    show()
    act(() => closeButton()?.click())
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('closes on a backdrop click but not on a click inside the panel', () => {
    show()
    act(() => {
      ;(harness.container.firstElementChild as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(panel()).toBeNull()

    show()
    act(() => {
      ;(panel() as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(panel()).not.toBeNull()
  })

  it('holds Tab on its only tabbable control', () => {
    show()
    act(() => panel()?.focus())
    act(() => {
      panel()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement).toBe(closeButton())
  })

  it('cycles Tab and Shift+Tab between the panel and its control, both ways', () => {
    // The trap used to prevent the default on either direction and focus the
    // close button, which left Shift+Tab with nowhere to go: a keyboard user
    // could move forwards nowhere and backwards nowhere, and could not tell
    // which way round a two-stop list went.
    show()
    const tab = (shiftKey: boolean) =>
      act(() => {
        ;(document.activeElement as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }),
        )
      })

    act(() => panel()?.focus())
    tab(false)
    expect(document.activeElement).toBe(closeButton())
    tab(false)
    expect(document.activeElement).toBe(panel())
    tab(true)
    expect(document.activeElement).toBe(closeButton())
    tab(true)
    expect(document.activeElement).toBe(panel())
  })

  it('swallows the Tab default, so focus cannot walk out behind the overlay', () => {
    show()
    act(() => panel()?.focus())
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      panel()?.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
  })

  it('renders exactly the rows the shortcut table produces', () => {
    show()
    const terms = Array.from(panel()?.querySelectorAll('dt') ?? []).map((node) => node.textContent)
    const definitions = Array.from(panel()?.querySelectorAll('dd') ?? []).map(
      (node) => node.textContent,
    )
    // The glyphs follow whatever `navigator` reports in this environment, so
    // the expectation is derived from the same source the overlay reads.
    const expected = shortcutRows(detectedPlatform())
    expect(terms).toEqual(expected.map((row) => row.keys))
    expect(definitions).toEqual(expected.map((row) => row.label))
    expect(terms.length).toBeGreaterThan(10)
  })

  it('uses Ctrl glyphs when the platform is not an Apple one', () => {
    const win = shortcutRows('Win32')
    expect(win.some((row) => row.keys === 'Ctrl+z')).toBe(true)
    expect(win.some((row) => row.keys.includes('⌘'))).toBe(false)
  })

  it('announces the rows as a description list, not a table of divs', () => {
    show()
    expect(panel()?.querySelector('dl')).not.toBeNull()
    expect(panel()?.querySelector('table')).toBeNull()
  })
})

/**
 * The two rows this file's copy audit is really about.
 *
 * `Enter` and `Escape` were labelled "Commit the open tool" and "Cancel the open
 * tool", which told a user pressing Enter that their change was being applied.
 * `useKeyboardShortcuts` wires them to `onCommit` and `onCancel`, and
 * `Editor.tsx:436-437` gives both handlers the same body —
 * `setActiveTool(null)`. In an editor whose panels apply live, "commit" is a
 * promise about a distinction the app does not have.
 */
describe('the two keys that close a panel say what they do', () => {
  const labelFor = (key: string) => shortcutRows('MacIntel').find((row) => row.keys === key)?.label

  it('Enter closes the panel, and does not claim to apply anything', () => {
    expect(labelFor('Enter')).toBe('Close the open panel')
  })

  it('Escape closes the panel and names the extra thing it does', () => {
    // Escape also calls `endInteraction()`, which is what stops a lost pointer
    // capture from freezing undo — worth saying, and the reason the two rows do
    // not read identically.
    expect(labelFor('Escape')).toMatch(/close the open panel/i)
    expect(labelFor('Escape')).toMatch(/drag/i)
  })

  it('no row claims a key applies, commits or cancels an edit', () => {
    for (const row of shortcutRows('MacIntel')) {
      expect(row.label, row.keys).not.toMatch(/commit|cancel/i)
    }
  })

  it('that is what the editor actually wires both handlers to', () => {
    // Asserted against the source, not against a stub, so the copy cannot drift
    // away from the two lines in `Editor.tsx` that make it true.
    const editor = readFileSync(resolve(process.cwd(), 'src/pages/Editor.tsx'), 'utf8')
    expect(editor).toMatch(
      /onCommit:\s*\(\)\s*=>\s*useUiStore\.getState\(\)\.setActiveTool\(null\)/,
    )
    expect(editor).toMatch(
      /onCancel:\s*\(\)\s*=>\s*useUiStore\.getState\(\)\.setActiveTool\(null\)/,
    )
  })
})

describe('the four shortcut groups are reachable, not just ordered', () => {
  it('renders one named region per group, in the order the source declares', () => {
    show()
    const regions = Array.from(panel()?.querySelectorAll('section[aria-label]') ?? []).map((node) =>
      node.getAttribute('aria-label'),
    )
    expect(regions).toEqual(SHORTCUT_GROUPS.map((group) => group.title))
  })

  it('each region holds exactly the rows its group owns', () => {
    show()
    for (const section of Array.from(panel()?.querySelectorAll('section[aria-label]') ?? [])) {
      const rendered = Array.from(section.querySelectorAll('dd')).map((node) => node.textContent)
      const source = shortcutSections('MacIntel').find(
        (candidate) => candidate.title === section.getAttribute('aria-label'),
      )
      expect(rendered, section.getAttribute('aria-label') ?? '').toEqual(
        source?.rows.map((row) => row.label),
      )
    }
  })

  it('no group renders as a bare heading with no rows under it', () => {
    for (const section of shortcutSections('MacIntel')) {
      expect(section.rows.length, section.id).toBeGreaterThan(0)
    }
  })
})

describe('the debug switches surface', () => {
  // `aria-labelledby`, not `aria-label`: the four shortcut regions are counted
  // by `section[aria-label]` in the tests above, and a second labelled region
  // would quietly change what they are asserting.
  const section = () =>
    Array.from(harness.container.querySelectorAll<HTMLElement>('section[aria-labelledby]')).find(
      (node) => node.querySelector('h3')?.textContent === 'Debug switches',
    )
  const text = () => section()?.textContent ?? ''
  const rowFor = (label: string) =>
    Array.from(section()?.querySelectorAll('li') ?? []).find(
      (li) => li.querySelector('strong')?.textContent === label,
    )?.textContent ?? ''
  const buttonNamed = (label: string) =>
    Array.from(section()?.querySelectorAll('button') ?? []).find((b) => b.textContent === label)

  beforeEach(() => {
    localStorage.removeItem(FLAGS_STORAGE_KEY)
    act(() => {
      resetFlags()
    })
    show()
  })

  afterEach(() => {
    localStorage.removeItem(FLAGS_STORAGE_KEY)
    act(() => {
      resetFlags()
    })
  })

  it('states in the UI, not only in the URL, that the app has debug switches', () => {
    // The requirement this whole module exists for: a user who pasted a URL
    // with ?off= has to be able to find out that such a thing exists, without
    // reading the source or guessing.
    expect(text()).toContain('This build has no server and no remote configuration')
    expect(text()).toContain('?features=matting')
    expect(text()).toContain('?off=matting')
    expect(text()).toContain('Anything you set in the address bar wins over the saved value.')
  })

  it('lists every declared flag with what it does by default', () => {
    for (const id of FLAG_IDS) expect(text()).toContain(id)
    expect(text()).toContain('Normally: Available. The model downloads from the CDN on first use.')
    // A saved flag the user does not remember setting has to say so.
    expect(rowFor('Background removal')).toContain('nothing has changed it')
  })

  it('says where a url flag came from, and offers nothing that cannot work', () => {
    act(() => {
      initFlags({ search: '?off=matting' })
    })
    expect(rowFor('Background removal')).toContain('from the address bar')
    expect(rowFor('Background removal')).toContain('remove ?off=matting from the address bar')
    // A button here would clear storage, which the url still overrules.
    expect(buttonNamed('Reset (1)')).toBeUndefined()
  })

  it('names a saved flag as saved, which is the residue a user has forgotten', () => {
    act(() => {
      setFlagState('export', 'off')
    })
    expect(rowFor('Full export')).toContain('off')
    expect(rowFor('Full export')).toContain('saved in this browser')
    expect(buttonNamed('Reset (2)')).toBeDefined()
  })

  it('turns a flag off from here, which is the action a user takes when one misbehaves', () => {
    // The round trip the diagnostics surface exists for: switch it off, and the
    // switch has to outlive the page load. `localStorage`, not the URL — a
    // panel cannot edit an address bar.
    expect(buttonNamed('Turn off (1)')).toBeDefined()
    act(() => {
      buttonNamed('Turn off (1)')?.click()
    })
    expect(JSON.parse(localStorage.getItem(FLAGS_STORAGE_KEY) ?? '{}')).toEqual({ matting: 'off' })
    expect(rowFor('Background removal')).toContain('off')
    expect(rowFor('Background removal')).toContain('saved in this browser')
    // And the control becomes the reset one, so the row is not a one-way door.
    expect(buttonNamed('Reset (1)')).toBeDefined()
    expect(buttonNamed('Turn off (1)')).toBeUndefined()
  })

  it('reaches the turn-off control from the keyboard', () => {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }),
      )
    })
    expect(JSON.parse(localStorage.getItem(FLAGS_STORAGE_KEY) ?? '{}')).toEqual({ export: 'off' })
  })

  it('gives a url row no key route, because nothing here can undo a query parameter', () => {
    act(() => {
      initFlags({ search: '?off=matting' })
    })
    const before = localStorage.getItem(FLAGS_STORAGE_KEY)
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }),
      )
    })
    expect(localStorage.getItem(FLAGS_STORAGE_KEY)).toBe(before)
    expect(buttonNamed('Turn off (1)')).toBeUndefined()
  })

  it('clears a saved flag in one click', () => {
    act(() => {
      setFlagState('export', 'off')
    })
    act(() => {
      buttonNamed('Reset (2)')?.click()
    })
    expect(localStorage.getItem(FLAGS_STORAGE_KEY)).toBeNull()
    expect(rowFor('Full export')).toContain('nothing has changed it')
  })

  it('clears them all in one click, and only offers that when there is something to clear', () => {
    expect(buttonNamed('Clear every saved switch (0)')).toBeUndefined()
    act(() => {
      setFlagState('export', 'off')
      setFlagState('matting', 'off')
    })
    expect(buttonNamed('Clear every saved switch (0)')).toBeDefined()
    act(() => {
      buttonNamed('Clear every saved switch (0)')?.click()
    })
    expect(localStorage.getItem(FLAGS_STORAGE_KEY)).toBeNull()
  })

  it('reaches the reset buttons from the keyboard, because they are outside the tab cycle', () => {
    act(() => {
      setFlagState('matting', 'off')
    })
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }),
      )
    })
    expect(localStorage.getItem(FLAGS_STORAGE_KEY)).toBeNull()
  })

  it('reports an id the url named that is not a flag, rather than swallowing it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    act(() => {
      initFlags({ search: '?features=nosuchthing' })
    })
    expect(text()).toContain('Not recognised, so ignored: nosuchthing')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
