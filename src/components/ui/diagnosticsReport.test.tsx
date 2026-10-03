import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDiagnosticsReport,
  clearDiagnostics,
  diagnosticEntries,
  recordDiagnostic,
} from '../../lib/diagnostics'
import { createHarness } from '../../store/testHarness'
import { DiagnosticsReport } from './DiagnosticsReport'

const harness = createHarness()

const button = () => harness.container.querySelector<HTMLButtonElement>('button')
const field = () => harness.container.querySelector<HTMLTextAreaElement>('textarea')
const status = () => harness.container.querySelector('[role="status"]')?.textContent ?? null

const render = (variant: 'inline' | 'onDemand' | 'revealed' = 'inline') =>
  act(() => {
    harness.render(<DiagnosticsReport variant={variant} />)
  })

const click = async () => {
  await act(async () => {
    button()?.click()
    // Two turns: `copyText` is awaited inside the handler, and the status is set
    // after it settles. One would pass on Chromium and fail here, which is the
    // wrong way round.
    await Promise.resolve()
    await Promise.resolve()
  })
}

function defineClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value })
}

beforeEach(() => {
  clearDiagnostics()
  recordDiagnostic({ level: 'error', tag: 'manual', message: 'a frame failed to render' })
  defineClipboard(undefined)
  Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined })
})

afterEach(() => {
  harness.unmount()
  clearDiagnostics()
  vi.restoreAllMocks()
})

describe('the crash screen copy block', () => {
  it('has the report in the page from the first paint, before anything is pressed', () => {
    render('inline')
    const text = field()?.value ?? ''
    // The app is dead at this point. Whatever the reader does next, the text is
    // already on the screen to be selected with a triple-click. Compared from
    // the events section down, because the storage line is the one fact the
    // component is still fetching at mount and this test has just seen it land.
    const events = (value: string) => value.split('— EVENTS')[1] ?? ''
    expect(events(text)).toBe(events(buildDiagnosticsReport()))
    expect(text).toContain('IMAGE EDITOR — DIAGNOSTICS')
    expect(text).toContain('a frame failed to render')
  })

  it('says what the report is, and what it is not, next to the field', () => {
    render('inline')
    const note = harness.container.querySelector('p')?.textContent ?? ''
    expect(note).toContain('Nothing here is sent anywhere')
    expect(note).toContain('no image, no pixel, no file name and no document')
  })

  it('names the field for a screen reader, and keeps it read-only', () => {
    render('inline')
    const area = field()
    expect(area?.getAttribute('aria-label')).toBe('Diagnostics report')
    expect(area?.readOnly).toBe(true)
  })

  it('copies through the clipboard API when it is allowed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineClipboard({ writeText })
    render('inline')
    await click()
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText.mock.calls[0]?.[0]).toContain('IMAGE EDITOR — DIAGNOSTICS')
    expect(status()).toContain('Copied to the clipboard')
  })

  it('still hands over the text when the clipboard API is refused', async () => {
    defineClipboard({
      writeText: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
    })
    render('inline')
    await click()
    // The permission error must not become the thing that stops a bug being
    // reported, so the outcome is spelled out rather than swallowed.
    expect(status()).toMatch(/clipboard is blocked|without the clipboard API/)
    expect(field()?.value).toContain('IMAGE EDITOR — DIAGNOSTICS')
  })

  it('selects the text and says which keys to press when nothing can copy it', async () => {
    render('inline')
    await click()
    expect(status()).toContain('Ctrl+C')
    expect(document.activeElement).toBe(field())
  })

  it('records that a report was taken, so a buffer knows one went out', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineClipboard({ writeText })
    render('inline')
    await click()
    expect(diagnosticEntries().some((entry) => entry.tag === 'manual')).toBe(true)
  })
})

describe('the same block, reached from a live app', () => {
  it('shows nothing until the copy is asked for', () => {
    render('onDemand')
    expect(button()?.textContent).toBe('Copy diagnostics')
    expect(field()).toBeNull()
  })

  it('reveals the text the moment it is asked for', async () => {
    render('onDemand')
    await click()
    expect(field()?.value).toContain('IMAGE EDITOR — DIAGNOSTICS')
    expect(status()).toBeTruthy()
  })

  it('renders the text with no button of its own when the host owns the control', () => {
    render('revealed')
    // `HelpOverlay` puts its own copy button in the dialog's head, because that
    // dialog's tab cycle is pinned to a single control.
    expect(button()).toBeNull()
    expect(field()?.value).toContain('IMAGE EDITOR — DIAGNOSTICS')
  })
})
