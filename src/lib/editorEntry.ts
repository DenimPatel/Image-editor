import type { ConfirmRequest } from './confirm'
import type { ToolId } from '../store/uiStore'

/**
 * What a door into the editor is asking for.
 *
 * `useDocStore` is a module singleton (`src/store/docStore.ts:80`), which is the
 * right design for "there is one document, and it is undoable" and the wrong one
 * for "this page was reached by pressing a button that said something". A
 * singleton answers whatever question was asked last, so an entry point that means
 * one thing can be handed another: the Hub's eight doors and the nav's "Open
 * Editor" all reopen whatever the singleton happens to hold, and nothing in the app
 * says so.
 *
 * So the two questions a door can ask are separated here, in one pure module,
 * instead of emerging from whichever branch of a component happened to run first:
 *
 * - **which tool** — `/editor/<segment>`, answered from `TOOL_IDS` and never from
 *   a guess. `/editor/:tool` matches any string, so a name that is not a tool has
 *   to answer "nothing" rather than "the closest one".
 * - **whose document** — answered by `resolveEditorEntry`, whose invariant is the
 *   whole of the item: **the editor opens the document the door named, or nothing
 *   at all.** Never a different one.
 *
 * The tools are a parameter rather than an import because `TOOL_IDS` lives in
 * `uiStore`, whose module body reads `localStorage` — a pure module that imports
 * it stops being pure at the point of import. The type is imported type-only,
 * which erases.
 */

/** The editor's doors. One row per `to`, so a card and the editor cannot disagree. */
export type HubDoor = {
  to: string
  /** The tool the URL names, or null for the whole workspace. */
  tool: ToolId | null
}

/**
 * Every path the Hub offers, and what each one means.
 *
 * The same eight doors `Hub.tsx` renders, declared here so the editor's idea of
 * `/editor/crop` and the card's idea of it are one fact. A card pointing at a
 * route that is not a tool renders the photo with no tab marked current and no
 * panel — a dead end reached by following the editor's own front page — and
 * `Hub.test.tsx` drives every row of this table through the real router.
 */
export const HUB_DOORS: HubDoor[] = [
  { to: '/editor/crop', tool: 'crop' },
  { to: '/editor/adjust', tool: 'adjust' },
  { to: '/editor/filters', tool: 'filters' },
  { to: '/editor/export', tool: 'export' },
  { to: '/editor/passport', tool: 'passport' },
  { to: '/editor/background', tool: 'background' },
  { to: '/editor/layers', tool: 'layers' },
  { to: '/editor', tool: null },
]

/**
 * The tool an `/editor/<segment>` URL names, or null.
 *
 * `tools` is passed rather than imported so the answer is a function of its
 * inputs; the caller hands it `TOOL_IDS`, which is the one list.
 */
export function editorEntryTool(pathname: string, tools: readonly ToolId[]): ToolId | null {
  const match = /^\/editor\/([^/]+)\/?$/.exec(pathname)
  const segment = match?.[1]
  if (!segment) return null
  return tools.find((tool) => tool === segment) ?? null
}

/**
 * The door a Hub card for `tool` points at — the inverse of `editorEntryTool`.
 *
 * `null` is the workspace door, the featured card that names no single tool of its
 * own, which is why this takes `ToolId | null` and answers with a path.
 *
 * This is what makes `HUB_DOORS` load-bearing in both directions. It was a table
 * nothing read at runtime: `Hub.tsx` held its own copy of the same eight paths,
 * `editorEntryTool` matched against this one, and the only thing keeping the two in
 * step was a unit test that compared them — an assertion wearing the costume of a
 * constant. Now the Hub asks this module where a card goes, so a card cannot name
 * a tool the editor answers differently, and a door added here cannot be
 * unreachable from the front page.
 *
 * `/editor` is the fallback rather than a throw, because "no tool" is a real
 * answer for the featured card. A typo would then land on a working page rather
 * than a dead one, so `Hub.test.tsx` still asserts the rendered hrefs are exactly
 * these paths and no others.
 */
export function hubDoorTo(tool: ToolId | null): string {
  const door = HUB_DOORS.find((candidate) => candidate.tool === tool)
  return door ? door.to : '/editor'
}

/** What the singleton holds, as far as the entry decision is concerned. */
export type HeldDocument = {
  /** What `doc.source` names. A document without one cannot be opened. */
  assetId: string | null
}

export type EditorEntryPlan =
  | { action: 'open'; tool: ToolId | null; sourceAssetId: string }
  /**
   * There is nothing to open. `reason` is for the log and for the test, not for
   * the screen: an editor with no document already says "Edit an image".
   */
  | { action: 'import'; tool: ToolId | null; reason: 'no-document' | 'source-unavailable' }

export type EditorEntryInput = {
  /** The tool the door named. Carried through so the caller applies one decision. */
  tool: ToolId | null
  /** What the singleton holds right now, or null if it holds nothing. */
  held: HeldDocument | null
  /**
   * "Can the asset store hand this document's pixels back as an `ImageBitmap`?",
   * asked by the caller because only the caller knows about the asset store. A
   * function rather than a store handle so the whole matrix is a table test.
   */
  holds: (assetId: string) => boolean
}

/**
 * Decide what the editor opens, from the door's intent and what is available.
 *
 * `tool` is honoured on both branches, deliberately: a deep link to
 * `/editor/crop` with no photo has to remember the tool it asked for, and the
 * import screen has to appear without discarding that.
 *
 * `source-unavailable` is the one that matters. A document whose source the asset
 * store cannot hand back is not quietly replaced by nothing and not quietly
 * replaced by *something else*; it is reported, and `Editor` raises the explicit
 * error naming the asset — which is what `bitmapFor` already does, and why this
 * function names the reason instead of making the caller's throw look accidental.
 */
export function resolveEditorEntry(input: EditorEntryInput): EditorEntryPlan {
  const { tool, held, holds } = input
  if (!held || held.assetId === null) return { action: 'import', tool, reason: 'no-document' }
  if (!holds(held.assetId)) return { action: 'import', tool, reason: 'source-unavailable' }
  return { action: 'open', tool, sourceAssetId: held.assetId }
}

/**
 * What "New image" costs, in the words that cost it.
 *
 * `null` when there is nothing to lose, which is the case that must *not* ask. A
 * confirmation in front of an action that destroys nothing is the dialog that
 * teaches people to press through dialogs.
 *
 * The count is `past.length` — the number of undo steps — because that is a
 * number the reader can check afterwards by pressing Undo that many times. It is
 * also exactly why the swap cannot itself be undoable: `load()` *replaces* the
 * document rather than pushing onto it, so the sentence below says the edits are
 * gone rather than implying an Undo would bring them back.
 */
export function newImageRequest(editCount: number): ConfirmRequest | null {
  if (editCount <= 0) return null
  const edits = editCount === 1 ? '1 edit' : `${editCount} edits`
  return {
    title: 'Start a new image?',
    body:
      `This photo has ${edits}. Starting a new image replaces it, and the edits cannot be undone ` +
      'afterwards — there is nothing to undo them back to. Your photo file itself is not touched.',
    confirmLabel: 'Start new image',
    tone: 'destructive',
  }
}

/**
 * Why the menu item cannot be pressed, when it cannot.
 *
 * A disabled control with no stated reason is the same dead end as a control that
 * does nothing: nothing distinguishes a broken button from a paused one. This is
 * an accessible *description*, so it is announced instead of drawn twice.
 *
 * The export is the one job in the editor that is reading the document while the
 * user changes it, so replacing the document underneath it hands the encoder a
 * photo the user did not ask to export.
 */
export function newImageBlockedReason(exportBusy: boolean): string | null {
  return exportBusy ? 'An export is running — wait for it to finish.' : null
}
