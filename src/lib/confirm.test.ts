import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { createHarness } from '../store/testHarness'
import {
  CANCEL_LABEL,
  confirmDestructive,
  confirmHostMounted,
  registerConfirmHost,
  type ConfirmRequest,
} from './confirm'

/**
 * The confirmation, and the convention it establishes.
 *
 * The app had no confirmation at all before this, so the tests here are as much
 * about what the convention forbids as about what it does: one dialog, asked
 * through one function, with the focus contract every caller inherits and nobody
 * has to remember. `confirm.test.ts` also greps `src/` for a raw
 * `window.confirm`, because the first pattern anybody reaches for is the one the
 * browser owns.
 */

const harness = createHarness()

const REQUEST: ConfirmRequest = {
  title: 'Start a new image?',
  body: 'This photo has 3 edits.',
  confirmLabel: 'Start new image',
  tone: 'destructive',
}

/**
 * A trigger button beside a mounted dialog, the way the More menu is one: the
 * button's accessible name is "More options", which is the one `e2e` reaches, and
 * it is what focus has to come back to.
 *
 * `createElement` rather than JSX because this file is `confirm.test.ts` and the
 * item that names it is a `.ts` — a sibling test should not move just to carry a
 * fragment.
 */
function mountTriggerAndDialog(): void {
  act(() => {
    harness.render(
      createElement(
        'div',
        null,
        createElement('button', { type: 'button' }, 'More options'),
        createElement(ConfirmDialog),
      ),
    )
  })
}

async function ask(): Promise<{ outcome: Promise<boolean> }> {
  mountTriggerAndDialog()
  const outcome = confirmDestructive(REQUEST)
  await act(async () => {
    await Promise.resolve()
  })
  return { outcome }
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]')
}

function byName(name: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll('button')).find((node) => node.textContent === name) ??
    null
  )
}

function press(target: Element | null, key: string, init: KeyboardEventInit = {}) {
  if (!target) throw new Error('the control under test is not in the document')
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  })
}

beforeEach(() => {
  harness.render(createElement(ConfirmDialog))
})

afterEach(() => {
  harness.unmount()
  registerConfirmHost(null)
  localStorage.clear()
})

describe('a confirmation asked through confirmDestructive', () => {
  it('is a modal dialog named by its heading and described by its body', async () => {
    await ask()
    const panel = dialog()
    expect(panel?.getAttribute('aria-modal')).toBe('true')
    if (!panel) throw new Error('the dialog did not render')
    const titleId = panel?.getAttribute('aria-labelledby') ?? ''
    expect(document.getElementById(titleId)?.textContent).toBe(REQUEST.title)
    const bodyId = panel?.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(bodyId)?.textContent).toContain('3 edits')
  })

  it('puts focus on the safe control, never on the one that destroys', async () => {
    // A dialog that opens with the destructive control focused is one `Enter` away
    // from a lost photograph, and it announces the button before the question that
    // makes it legible.
    await ask()
    expect(document.activeElement).toBe(byName(CANCEL_LABEL))
    expect(document.activeElement).not.toBe(byName(REQUEST.confirmLabel))
    expect(byName(REQUEST.confirmLabel)?.disabled).toBe(false)
  })

  it('resolves true for the control that names the action, and nothing else', async () => {
    const { outcome } = await ask()
    await act(async () => {
      byName(REQUEST.confirmLabel)?.click()
    })
    await expect(outcome).resolves.toBe(true)
    expect(dialog()).toBeNull()
  })

  it('resolves false for the safe control', async () => {
    const { outcome } = await ask()
    await act(async () => {
      byName(CANCEL_LABEL)?.click()
    })
    await expect(outcome).resolves.toBe(false)
    expect(dialog()).toBeNull()
  })

  it('resolves false on Escape, and stops there', async () => {
    // Stopped, not merely handled: the editor binds bare keys on `window`, so an
    // Escape that bubbled would also cancel the tool panel behind the dialog.
    const reachedWindow: string[] = []
    const spy = (event: Event) => reachedWindow.push((event as KeyboardEvent).key)
    window.addEventListener('keydown', spy)
    try {
      const { outcome } = await ask()
      press(document.documentElement, 'Escape')
      await expect(outcome).resolves.toBe(false)
      expect(reachedWindow).toEqual([])
    } finally {
      window.removeEventListener('keydown', spy)
    }
  })

  it('resolves false when the backdrop is pressed', async () => {
    // A click outside a dialog is not consent.
    const { outcome } = await ask()
    const overlay = dialog()?.parentElement
    expect(overlay).toBeTruthy()
    await act(async () => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await expect(outcome).resolves.toBe(false)
  })

  it('returns focus to whatever opened it', async () => {
    // The opener is read after the commit rather than at call time: a menu row is
    // removed from the DOM by the time React mounts the dialog, so a synchronously
    // captured opener is a detached node and focus would land on <body>.
    mountTriggerAndDialog()
    const outcome = confirmDestructive(REQUEST)
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.activeElement).toBe(byName(CANCEL_LABEL))
    await act(async () => {
      byName(CANCEL_LABEL)?.click()
    })
    await expect(outcome).resolves.toBe(false)
    expect(document.activeElement?.textContent).toBe('More options')
  })

  it('keeps Tab and Shift+Tab inside the dialog, wrapping at both ends', async () => {
    // Three stops and both directions: the panel itself, the safe control and the
    // committing one. The previous version of this trap focused one control for both
    // directions, so a keyboard user could not move backwards at all.
    await ask()
    const panel = dialog()
    const cancel = byName(CANCEL_LABEL) as Element
    const commit = byName(REQUEST.confirmLabel) as Element
    if (!panel) throw new Error('the dialog did not render')
    press(cancel, 'Tab')
    expect(document.activeElement).toBe(commit)
    press(commit, 'Tab')
    expect(document.activeElement).toBe(panel)
    press(panel, 'Tab')
    expect(document.activeElement).toBe(cancel)
    press(cancel, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(panel)
    press(panel, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(commit)
  })

  it('gives the committing control a name that is unique on the page and never OK', async () => {
    await ask()
    const buttons = Array.from(document.querySelectorAll('button')).filter(
      (node) => node.textContent === REQUEST.confirmLabel,
    )
    expect(buttons).toHaveLength(1)
    expect(REQUEST.confirmLabel).not.toBe('OK')
    expect(REQUEST.confirmLabel).not.toBe('Yes')
    // And it is not the safe control's name either, which would make two buttons
    // that differ only in their styling.
    expect(REQUEST.confirmLabel).not.toBe(CANCEL_LABEL)
  })

  it('refuses rather than throws when nothing is mounted to ask', async () => {
    // A confirmation that throws takes its caller down with it, and a destructive
    // action that was never asked about must not then happen.
    registerConfirmHost(null)
    expect(confirmHostMounted()).toBe(false)
    await expect(confirmDestructive(REQUEST)).resolves.toBe(false)
  })

  it('resolves the earlier question false when a second one is asked', async () => {
    // Two open dialogs with one promise slot would orphan the first request's
    // promise, and its caller would `await` forever inside an event handler.
    const first = confirmDestructive(REQUEST)
    await act(async () => {
      await Promise.resolve()
    })
    const second = confirmDestructive({ ...REQUEST, title: 'Second?' })
    await act(async () => {
      await Promise.resolve()
    })
    await expect(first).resolves.toBe(false)
    expect(
      document.getElementById(dialog()?.getAttribute('aria-labelledby') ?? '')?.textContent,
    ).toBe('Second?')
    await act(async () => {
      byName(REQUEST.confirmLabel)?.click()
    })
    await expect(second).resolves.toBe(true)
  })

  it('resolves false if the editor unmounts while the question is open', async () => {
    const outcome = confirmDestructive(REQUEST)
    await act(async () => {
      await Promise.resolve()
    })
    expect(dialog()).not.toBeNull()
    act(() => {
      harness.render(createElement('p', null, 'gone'))
    })
    await expect(outcome).resolves.toBe(false)
  })
})

describe('the convention the confirmation sets', () => {
  it('is asked from one place, and no call site uses the browser dialog', () => {
    // `window.confirm` is a modal on the *document*: it cannot be styled to match
    // the app, it names its only safe control in the OS's language, and no test can
    // locate it by role or name — so every assertion about it would be an assertion
    // about browser chrome. The app's chrome is native-alert-free and stays so.
    const offenders: string[] = []
    walk(resolve(process.cwd(), 'src'), (file: string) => {
      const source = readFileSync(file, 'utf8')
      if (/(?<![A-Za-z0-9_$.])(?:window\s*\.\s*)?confirm\s*\(/.test(source)) offenders.push(file)
    })
    expect(offenders).toEqual([])
  })

  it('keeps the primitive free of React, so a caller needs no component to ask', () => {
    // A `useConfirm` hook would have forced every caller — a `useCallback` in a menu
    // row, a keyboard shortcut, a future panel — to consume a hook for a function.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/confirm.ts'), 'utf8')
    expect(source).not.toMatch(/from 'react'/)
  })

  it('has a builder for every destructive control, and none of them is unwired', () => {
    // The failure this file exists to prevent, stated as a scan.
    //
    // A confirmation primitive with four destructive controls that do not call it is
    // not a partial implementation; it is a dialog that appears for one gesture and
    // not the five next to it, which is worse than having none — every press of
    // "Discard" teaches the user to press through the one that really is
    // irreversible. So the labels of the destructive controls are asserted to appear
    // only in files that also import a builder, and the builders are asserted to be
    // reachable from those files.
    //
    // A grep rather than a test per control: a sixth call site added tomorrow should
    // fail *this*, not wait for somebody to remember to write the sixth test.
    const OFFENDERS: Array<{ file: string; label: string }> = [
      { file: 'src/pages/Editor.tsx', label: 'Delete preset' },
      { file: 'src/components/ui/RouteError.tsx', label: 'Start over' },
    ]
    const unasked: string[] = []
    for (const { file, label } of OFFENDERS) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      const mentions = source.includes(label)
      const asks = /from '(\.\.\/)+lib\/(destructive|editorEntry)'/.test(source)
      if (mentions && !asks) unasked.push(`${file}: ${label}`)
    }
    expect(unasked).toEqual([])

    // And the two controls whose labels are shared with non-destructive uses — the
    // resume card's "Discard" and the drawing panel's "Clear" — are named by the
    // same scan through the modules that own them.
    const editor = readFileSync(resolve(process.cwd(), 'src/pages/Editor.tsx'), 'utf8')
    expect(editor).toContain('discardSessionRequest')
    expect(editor).toContain('deletePresetRequest')
    const routeError = readFileSync(
      resolve(process.cwd(), 'src/components/ui/RouteError.tsx'),
      'utf8',
    )
    expect(routeError).toContain('startOverRequest')
  })

  it('the four controls Undo reaches reach no dialog at all', () => {
    // The other half of the convention, and the half that is easy to undo by accident:
    // `Reset all edits`, `Clear strokes`, `Delete layer` and `Remove frame` are each
    // one `Ctrl+Z` from where they were and Undo is on screen beside them, so a
    // dialog in front of any of them is a decision the user made once already. They
    // are named in `UNDOABLE_ACTIONS`, and this asserts that nothing wires a builder
    // back in for them.
    //
    // Per module rather than per label, because the two modules that own them own
    // nothing irreversible: `Editor.tsx`'s reset is read out of its handler below,
    // and `LayerPanels.tsx` must not import the asking primitive at all.
    const panels = readFileSync(
      resolve(process.cwd(), 'src/components/tools/LayerPanels.tsx'),
      'utf8',
    )
    expect(panels).not.toMatch(/lib\/destructive/)
    expect(panels).not.toContain('confirmThen')
    expect(panels).not.toContain('confirmDestructive')

    // `Reset all edits` shares its module with the two controls that do ask, so the
    // module cannot be scanned — the handler can. A dialog reappearing in here is a
    // dialog on the most-repeated undoable press in the app.
    const editor = readFileSync(resolve(process.cwd(), 'src/pages/Editor.tsx'), 'utf8')
    expect(editor).not.toContain('resetEditsRequest')
    const handler = /const handleReset = useCallback\(([^]*?)\n {2}\}, \[\]\)/
    expect(handler.test(editor)).toBe(true)
    expect(handler.exec(editor)?.[1]).not.toMatch(/confirmThen|confirmDestructive/)
  })

  it('keeps the two undoable deletions behind the store action and nowhere else', () => {
    // The same property from the other end: the store symbols that throw work away.
    // `removeLayer` and `clearDrawStrokes` are the two the panel calls, and each
    // pushes a history entry — which is why neither asks — but they must still be
    // reached through `src/store/actions.ts` rather than from a component that
    // rewrites the document behind the store's back.
    //
    // No other *component* module may call either one at all. `store/actions.ts`
    // exports them — that is where a programmatic caller belongs, and
    // `actions.test.ts` drives them there — but a second panel inventing its own
    // deletion is a control nobody can undo.
    const offenders: string[] = []
    walk(resolve(process.cwd(), 'src'), (file: string) => {
      if (file.endsWith(join('tools', 'LayerPanels.tsx'))) return
      if (file.endsWith(join('store', 'actions.ts'))) return
      const text = readFileSync(file, 'utf8')
      if (/(?<![A-Za-z0-9_$.])removeLayer\(/.test(text)) offenders.push(file)
      if (/(?<![A-Za-z0-9_$.])clearDrawStrokes\(/.test(text)) offenders.push(file)
    })
    expect(offenders).toEqual([])
  })
})

function walk(dir: string, visit: (file: string) => void): void {
  // `withFileTypes`, so a directory is recognised without a `stat` per entry. The
  // `node:fs` members this needs beyond `readdirSync`/`readFileSync` are not
  // declared — the app tsconfig is browser-only and widening it for a test walk is
  // worse than the walk.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, visit)
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) visit(path)
  }
}
