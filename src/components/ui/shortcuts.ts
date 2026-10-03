import { TOOL_IDS, type ToolId } from '../../store/uiStore'

/**
 * The single source of truth for what the editor's keyboard shortcuts are.
 *
 * It used to be a hand-maintained ten-row table in `HelpOverlay.tsx` that
 * duplicated `TOOL_KEYS` in `useKeyboardShortcuts.ts` and had already drifted:
 * it advertised `'0 / 1'` as "Fit / 100%" when nothing anywhere computes a
 * fit-to-screen, and it printed macOS glyphs on every platform even though the
 * hook accepts Ctrl just as happily as ⌘. `shortcuts.test.ts` asserts every
 * entry here is a key the hook's switch really handles, so the two cannot drift
 * again silently.
 */

export type ShortcutGroup = 'tools' | 'edit' | 'view' | 'session'

export type Shortcut = {
  /** Physical key, exactly as it appears in the hook's `TOOL_KEYS` / `switch`. */
  key: string
  /** `true` when the entry needs a Command/Control modifier. */
  mod?: boolean
  /** `true` when Shift is part of the chord. */
  shift?: boolean
  label: string
  group: ShortcutGroup
}

export type ShortcutRow = { keys: string; label: string }

export const TOOL_SHORTCUT_LABELS: Record<ToolId, string> = {
  crop: 'Crop',
  adjust: 'Adjust',
  filters: 'Looks',
  retouch: 'Retouch',
  background: 'Background',
  text: 'Text',
  draw: 'Draw',
  stickers: 'Stickers',
  redact: 'Redact',
  frame: 'Frame',
  layers: 'Layers',
  passport: 'Passport',
  export: 'Export',
}

/** `TOOL_KEYS` in `useKeyboardShortcuts.ts`, verbatim — five of the thirteen
 *  tools have a single-key shortcut, and the help says so rather than implying
 *  every tab does. */
export const TOOL_SHORTCUTS: { key: string; tool: ToolId }[] = [
  { key: 'c', tool: 'crop' },
  { key: 'a', tool: 'adjust' },
  { key: 't', tool: 'text' },
  { key: 'b', tool: 'draw' },
  { key: 'e', tool: 'export' },
]

export const SHORTCUTS: Shortcut[] = [
  { key: 'z', mod: true, label: 'Undo', group: 'edit' },
  { key: 'z', mod: true, shift: true, label: 'Redo', group: 'edit' },
  { key: 's', mod: true, label: 'Export', group: 'edit' },
  { key: '[', label: 'Rotate 90° anticlockwise', group: 'edit' },
  { key: ']', label: 'Rotate 90° clockwise', group: 'edit' },
  { key: 'f', label: 'Flip horizontally', group: 'edit' },
  // Both of these close the open panel, and they are labelled differently
  // because they are not the same key: `Enter` is wired to `onCommit` and
  // `Escape` to `onCancel`, and `Editor.tsx` gives those two handlers the same
  // body. The old labels said "Commit the open tool" and "Cancel the open tool",
  // which is the claim that matters — an editor where one key applies and the
  // other backs out is a promise about a distinction the app does not have.
  { key: 'Escape', label: 'Close the open panel and end a drag in progress', group: 'edit' },
  { key: 'Enter', label: 'Close the open panel', group: 'edit' },
  { key: '0', label: 'Reset zoom and pan', group: 'view' },
  { key: '1', label: 'Zoom to 100%', group: 'view' },
  { key: '\\', label: 'Hold to compare with the original', group: 'view' },
  { key: '?', label: 'Toggle this help', group: 'session' },
]

export const SHORTCUT_GROUPS: { id: ShortcutGroup; title: string }[] = [
  { id: 'tools', title: 'Tools' },
  { id: 'edit', title: 'Editing' },
  { id: 'view', title: 'Canvas' },
  { id: 'session', title: 'Session' },
]

const APPLE_PLATFORMS = /mac|iphone|ipad|ipod/i

/**
 * `navigator.platform` is deprecated but it is the only synchronous answer
 * available before first paint, and it is what the glyph choice has always hung
 * off. `navigator.userAgentData.platform` is preferred where present.
 */
export function detectedPlatform(): string {
  if (typeof navigator === 'undefined') return ''
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  return data?.platform ?? navigator.platform ?? ''
}

export function isApplePlatform(platform: string): boolean {
  return APPLE_PLATFORMS.test(platform)
}

/** `⌘` on Apple platforms, `Ctrl` everywhere else — the hook accepts both. */
export function modifierLabel(platform: string): string {
  return isApplePlatform(platform) ? '⌘' : 'Ctrl'
}

function chordKey(shortcut: Shortcut, platform: string): string {
  const apple = isApplePlatform(platform)
  const parts: string[] = []
  if (shortcut.mod) parts.push(apple ? '⌘' : 'Ctrl')
  if (shortcut.shift) parts.push(apple ? '⇧' : 'Shift')
  parts.push(shortcut.key)
  return parts.join(apple ? '' : '+')
}

/** The tool keys, collapsed into one `c a t b e` line. */
export function toolShortcutKeys(): string {
  return TOOL_SHORTCUTS.map((entry) => entry.key).join(' ')
}

export function toolShortcutLabel(): string {
  return TOOL_SHORTCUTS.map((entry) => TOOL_SHORTCUT_LABELS[entry.tool]).join(' / ')
}

/** One labelled block of rows, in `SHORTCUT_GROUPS` order. */
export type ShortcutSection = { id: ShortcutGroup; title: string; rows: ShortcutRow[] }

/**
 * The overlay's rows, grouped.
 *
 * `SHORTCUT_GROUPS` used to be exported and never rendered: `shortcutRows`
 * flattened it away, so the four headings were four strings no user could see —
 * which is how this table's earlier version rotted. Grouping is what the source
 * order was always for, and a group with no rows in it is dropped rather than
 * rendered as a bare heading.
 */
export function shortcutSections(platform: string): ShortcutSection[] {
  return SHORTCUT_GROUPS.flatMap((group) => {
    const rows =
      group.id === 'tools'
        ? [{ keys: toolShortcutKeys(), label: toolShortcutLabel() }]
        : SHORTCUTS.filter((shortcut) => shortcut.group === group.id).map((shortcut) => ({
            keys: chordKey(shortcut, platform),
            label: shortcut.label,
          }))
    return rows.length > 0 ? [{ ...group, rows }] : []
  })
}

/** Every row the overlay renders, in group order, with platform-correct glyphs. */
export function shortcutRows(platform: string): ShortcutRow[] {
  return shortcutSections(platform).flatMap((section) => section.rows)
}

/** `true` for every tool the hook does not give a single-key shortcut. */
export function toolsWithoutShortcut(): ToolId[] {
  const mapped = new Set(TOOL_SHORTCUTS.map((entry) => entry.tool))
  return TOOL_IDS.filter((tool) => !mapped.has(tool))
}

/** Tool ids in `TOOL_SHORTCUTS` that are not real tools. */
export function unknownToolShortcuts(): string[] {
  return TOOL_SHORTCUTS.filter((entry) => !TOOL_IDS.includes(entry.tool)).map((entry) => entry.key)
}
